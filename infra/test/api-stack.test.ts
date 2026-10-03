import { fileURLToPath } from 'node:url';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, test } from 'vitest';
import { ApiStack } from '../lib/api-stack.ts';
import { testApp } from './test-app.ts';

// The API (S2-09, ADR-0009 §6). Expected values are written out literally, so changing a
// setting in the code also fails here. The stack gets a fixed account and us-east-1, so ARNs in
// the template are plain strings.

const ME = fileURLToPath(new URL('./fixtures/me', import.meta.url));
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
    expect(methods.map((method) => method.HttpMethod).sort()).toEqual([
      'GET',
      'OPTIONS',
      'OPTIONS',
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

  test('preflight allows only the web origin, GET, and the Authorization header', () => {
    template.hasResourceProperties('AWS::ApiGateway::Method', {
      HttpMethod: 'OPTIONS',
      Integration: Match.objectLike({
        IntegrationResponses: [
          Match.objectLike({
            ResponseParameters: Match.objectLike({
              'method.response.header.Access-Control-Allow-Origin': `'${ORIGIN}'`,
              'method.response.header.Access-Control-Allow-Methods': "'GET'",
              'method.response.header.Access-Control-Allow-Headers': "'Authorization'",
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

  // Exact match: a new action or resource needs a decision, as for the pre sign-up trigger.
  test('the Lambda may only get and put items, in the data table only', () => {
    const statements = propertiesOf('AWS::IAM::Policy').flatMap(
      (policy) => (policy.PolicyDocument as { Statement: unknown[] }).Statement,
    );
    expect(statements).toEqual([
      {
        Effect: 'Allow',
        Action: ['dynamodb:GetItem', 'dynamodb:PutItem'],
        Resource: 'arn:aws:dynamodb:us-east-1:111111111111:table/cv-tailor-dev-data',
      },
    ]);
  });

  test('only API Gateway may invoke the Lambda, for GET /me on its real stage', () => {
    template.resourceCountIs('AWS::Lambda::Permission', 1);
    template.hasResourceProperties('AWS::Lambda::Permission', {
      Action: 'lambda:InvokeFunction',
      Principal: 'apigateway.amazonaws.com',
      // This API, its live stage, and GET /me only: not any method, path, or stage.
      SourceArn: {
        'Fn::Join': [
          '',
          [
            'arn:aws:execute-api:us-east-1:111111111111:',
            { Ref: Match.stringLikeRegexp('^Api') },
            '/',
            { Ref: Match.stringLikeRegexp('^ApiDeploymentStagelive') },
            '/GET/me',
          ],
        ],
      },
    });
  });

  // The table lives in <env>-Data. This stack only refers to it by name.
  test('creates no table', () => {
    template.resourceCountIs('AWS::DynamoDB::GlobalTable', 0);
    template.resourceCountIs('AWS::DynamoDB::Table', 0);
  });
});
