import { fileURLToPath } from 'node:url';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, test } from 'vitest';
import { ApiStack } from '../lib/api-stack.ts';
import { testApp } from './test-app.ts';

// The API (S2-09, ADR-0009 §6). Expected values are written out literally, so changing a
// setting in the code also fails here. The stack gets a fixed account and us-east-1, so ARNs in
// the template are plain strings.

const ME = fileURLToPath(new URL('./fixtures/me', import.meta.url));
const DOCUMENTS = fileURLToPath(new URL('./fixtures/documents', import.meta.url));
const TABLE_ARN = 'arn:aws:dynamodb:us-east-1:111111111111:table/cv-tailor-dev-data';
const BUCKET_ARN = 'arn:aws:s3:::cv-tailor-dev-documents-111111111111';
const ORIGIN = 'https://dev.cv.ikiwii.com';

interface CfnResource {
  readonly Type: string;
  readonly Properties: Record<string, unknown>;
}

describe('API stack', () => {
  const stack = new ApiStack(testApp(), 'Api', {
    host: 'dev.cv.ikiwii.com',
    tableName: 'cv-tailor-dev-data',
    webOrigin: ORIGIN,
    meDirectory: ME,
    documentsBucketName: 'cv-tailor-dev-documents-111111111111',
    createDocumentDirectory: DOCUMENTS,
    listDocumentsDirectory: DOCUMENTS,
    deleteDocumentDirectory: DOCUMENTS,
    env: { account: '111111111111', region: 'us-east-1' },
  });
  const template = Template.fromStack(stack);
  const resources = Object.values(template.toJSON().Resources as Record<string, CfnResource>);
  const propertiesOf = (type: string) =>
    resources.filter((resource) => resource.Type === type).map((resource) => resource.Properties);
  const parameterId = (prefix: string) =>
    Object.keys(template.findParameters('*')).find((id) => id.startsWith(prefix));
  const userPoolIdParameter = parameterId('SsmParameterValuecvtailorauthuserpoolid');
  const zoneIdParameter = parameterId('SsmParameterValuecvtailordnszoneid');
  const certificateArnParameter = parameterId('SsmParameterValuecvtailordnscertificatearn');

  test('reads the pool ID, zone ID, and certificate ARN from SSM, not from exports', () => {
    template.hasParameter(userPoolIdParameter!, {
      Type: 'AWS::SSM::Parameter::Value<String>',
      Default: '/cv-tailor/auth/user-pool-id',
    });
    template.hasParameter(zoneIdParameter!, { Default: '/cv-tailor/dns/zone-id' });
    template.hasParameter(certificateArnParameter!, { Default: '/cv-tailor/dns/certificate-arn' });
    expect(JSON.stringify(template.toJSON())).not.toContain('Fn::ImportValue');
  });

  test('is a regional REST API, reachable only at its custom domain', () => {
    template.hasResourceProperties('AWS::ApiGateway::RestApi', {
      Name: 'cv-tailor-api',
      EndpointConfiguration: { Types: ['REGIONAL'] },
      DisableExecuteApiEndpoint: true,
    });
    template.hasResourceProperties('AWS::ApiGateway::DomainName', {
      DomainName: 'api.dev.cv.ikiwii.com',
      EndpointConfiguration: { Types: ['REGIONAL'] },
      SecurityPolicy: 'TLS_1_2',
      RegionalCertificateArn: { Ref: certificateArnParameter },
    });
    template.resourceCountIs('AWS::ApiGateway::BasePathMapping', 1);
    template.hasResourceProperties('AWS::Route53::RecordSet', {
      Name: 'api.dev.cv.ikiwii.com.',
      Type: 'A',
      HostedZoneId: { Ref: zoneIdParameter },
    });
  });

  test('creates no account-wide CloudWatch role for API Gateway', () => {
    template.resourceCountIs('AWS::ApiGateway::Account', 0);
  });

  test('checks tokens with the user pool from SSM', () => {
    template.hasResourceProperties('AWS::ApiGateway::Authorizer', {
      Type: 'COGNITO_USER_POOLS',
      IdentitySource: 'method.request.header.Authorization',
      ProviderARNs: [
        Match.objectLike({
          'Fn::Join': ['', Match.arrayWith([{ Ref: userPoolIdParameter }])],
        }),
      ],
    });
  });

  test('GET /me needs an access token with the API scope', () => {
    template.hasResourceProperties('AWS::ApiGateway::Method', {
      HttpMethod: 'GET',
      AuthorizationType: 'COGNITO_USER_POOLS',
      AuthorizationScopes: ['cv-tailor-api/user'],
      AuthorizerId: { Ref: Match.stringLikeRegexp('^Authorizer') },
    });
  });

  // A method added later without the authorizer fails here, before it can be deployed.
  test('every method needs the authorizer and the scope, except preflight', () => {
    const methods = propertiesOf('AWS::ApiGateway::Method');
    // GET /me, GET and POST /documents, DELETE /documents/{id}, and preflight on /, /me,
    // /documents, and /documents/{id}.
    expect(methods.map((method) => method.HttpMethod).sort()).toEqual([
      'DELETE',
      'GET',
      'GET',
      'OPTIONS',
      'OPTIONS',
      'OPTIONS',
      'OPTIONS',
      'POST',
    ]);
    for (const method of methods) {
      if (method.HttpMethod === 'OPTIONS') {
        expect(method.AuthorizationType ?? 'NONE').toBe('NONE');
      } else {
        expect(method.AuthorizationType).toBe('COGNITO_USER_POOLS');
        expect(method.AuthorizationScopes).toEqual(['cv-tailor-api/user']);
      }
    }
  });

  test('preflight allows only the web origin, the methods in use, and two headers', () => {
    template.hasResourceProperties('AWS::ApiGateway::Method', {
      HttpMethod: 'OPTIONS',
      Integration: Match.objectLike({
        IntegrationResponses: [
          Match.objectLike({
            ResponseParameters: Match.objectLike({
              'method.response.header.Access-Control-Allow-Origin': `'${ORIGIN}'`,
              'method.response.header.Access-Control-Allow-Methods': "'GET,POST,DELETE'",
              'method.response.header.Access-Control-Allow-Headers': "'Authorization,Content-Type'",
              'method.response.header.Access-Control-Max-Age': "'3600'",
            }),
          }),
        ],
      }),
    });
  });

  test.each(['UNAUTHORIZED', 'DEFAULT_4XX', 'DEFAULT_5XX'])(
    'the %s gateway response carries the CORS header',
    (type) => {
      template.hasResourceProperties('AWS::ApiGateway::GatewayResponse', {
        ResponseType: type,
        ResponseParameters: { 'gatewayresponse.header.Access-Control-Allow-Origin': `'${ORIGIN}'` },
      });
    },
  );

  test('no response allows any origin', () => {
    expect(JSON.stringify(template.toJSON())).not.toContain("'*'");
  });

  test('throttles every method at 5 requests a second, with a burst of 10', () => {
    template.hasResourceProperties('AWS::ApiGateway::Stage', {
      StageName: 'live',
      MethodSettings: [
        Match.objectLike({
          HttpMethod: '*',
          ResourcePath: '/*',
          ThrottlingRateLimit: 5,
          ThrottlingBurstLimit: 10,
        }),
      ],
    });
  });

  test('runs GET /me on Node.js 24, arm64, with its settings and a one-month log', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs24.x',
      Architectures: ['arm64'],
      Handler: 'index.handler',
      Timeout: 10,
      MemorySize: 512,
      Environment: { Variables: { TABLE_NAME: 'cv-tailor-dev-data', ALLOWED_ORIGIN: ORIGIN } },
    });
    template.hasResourceProperties('AWS::Logs::LogGroup', { RetentionInDays: 30 });
  });

  test.each([
    ['CreateDocument', 20],
    ['ListDocuments', 20],
    ['DeleteDocument', 15],
  ])('runs %s with the table, the bucket, the origin, and a %i-second timeout', (id, timeout) => {
    const [fn] = Object.entries(template.findResources('AWS::Lambda::Function'))
      .filter(([logicalId]) => logicalId.startsWith(id))
      .map(([, resource]) => (resource as CfnResource).Properties);
    expect(fn).toMatchObject({
      Runtime: 'nodejs24.x',
      Architectures: ['arm64'],
      Handler: 'index.handler',
      Timeout: timeout,
      MemorySize: 512,
      Environment: {
        Variables: {
          TABLE_NAME: 'cv-tailor-dev-data',
          BUCKET_NAME: 'cv-tailor-dev-documents-111111111111',
          ALLOWED_ORIGIN: ORIGIN,
        },
      },
    });
  });

  test('every Lambda keeps its log for one month', () => {
    const groups = propertiesOf('AWS::Logs::LogGroup');
    expect(groups).toHaveLength(4);
    for (const group of groups) expect(group.RetentionInDays).toBe(30);
  });

  // Exact match, for each Lambda: a new action or resource needs a decision, as for the pre
  // sign-up trigger. Each function gets only the calls its own code makes (S3-07).
  const statementsOf = (functionId: string) => {
    const found = Object.entries(template.findResources('AWS::IAM::Policy')).filter(([id]) =>
      id.startsWith(`${functionId}ServiceRoleDefaultPolicy`),
    );
    expect(found).toHaveLength(1);
    return ((found[0]![1] as CfnResource).Properties.PolicyDocument as { Statement: unknown[] })
      .Statement;
  };
  const LIST_KB_PREFIX = {
    Effect: 'Allow',
    Action: 's3:ListBucket',
    Resource: BUCKET_ARN,
    Condition: { StringLike: { 's3:prefix': 'kb/*' } },
  };

  test('there is one policy for each Lambda, and no other', () => {
    template.resourceCountIs('AWS::IAM::Policy', 4);
  });

  test.each<[string, unknown[]]>([
    [
      'Me',
      [{ Effect: 'Allow', Action: ['dynamodb:GetItem', 'dynamodb:PutItem'], Resource: TABLE_ARN }],
    ],
    [
      'CreateDocument',
      [
        {
          Effect: 'Allow',
          Action: [
            'dynamodb:DeleteItem',
            'dynamodb:GetItem',
            'dynamodb:PutItem',
            'dynamodb:Query',
            'dynamodb:UpdateItem',
          ],
          Resource: TABLE_ARN,
        },
        {
          Effect: 'Allow',
          Action: ['s3:DeleteObject', 's3:PutObject'],
          Resource: `${BUCKET_ARN}/kb/*`,
        },
        LIST_KB_PREFIX,
      ],
    ],
    [
      'ListDocuments',
      [
        {
          Effect: 'Allow',
          Action: [
            'dynamodb:DeleteItem',
            'dynamodb:GetItem',
            'dynamodb:Query',
            'dynamodb:UpdateItem',
          ],
          Resource: TABLE_ARN,
        },
        { Effect: 'Allow', Action: 's3:DeleteObject', Resource: `${BUCKET_ARN}/kb/*` },
        LIST_KB_PREFIX,
      ],
    ],
    [
      'DeleteDocument',
      [
        {
          Effect: 'Allow',
          Action: ['dynamodb:DeleteItem', 'dynamodb:GetItem', 'dynamodb:UpdateItem'],
          Resource: TABLE_ARN,
        },
        { Effect: 'Allow', Action: 's3:DeleteObject', Resource: `${BUCKET_ARN}/kb/*` },
      ],
    ],
  ])('%s may make only the calls its code makes (exact match)', (functionId, expected) => {
    expect(statementsOf(functionId)).toEqual(expected);
  });

  // This API, its live stage, and one method and path each: not any method, path, or stage.
  test.each([
    ['GET', '/me'],
    ['GET', '/documents'],
    ['POST', '/documents'],
    ['DELETE', '/documents/*'],
  ])('only API Gateway may invoke the Lambda for %s %s, on its real stage', (method, path) => {
    template.hasResourceProperties('AWS::Lambda::Permission', {
      Action: 'lambda:InvokeFunction',
      Principal: 'apigateway.amazonaws.com',
      SourceArn: {
        'Fn::Join': [
          '',
          [
            'arn:aws:execute-api:us-east-1:111111111111:',
            { Ref: Match.stringLikeRegexp('^Api') },
            '/',
            { Ref: Match.stringLikeRegexp('^ApiDeploymentStagelive') },
            `/${method}${path}`,
          ],
        ],
      },
    });
  });

  test('there is one invoke permission for each route, and no other', () => {
    template.resourceCountIs('AWS::Lambda::Permission', 4);
  });

  // The table lives in <env>-Data. This stack only refers to it by name.
  test('creates no table', () => {
    template.resourceCountIs('AWS::DynamoDB::GlobalTable', 0);
    template.resourceCountIs('AWS::DynamoDB::Table', 0);
  });
});
