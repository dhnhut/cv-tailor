import { Duration, Stack, type StackProps } from 'aws-cdk-lib';
import {
  AuthorizationType,
  CognitoUserPoolsAuthorizer,
  EndpointType,
  LambdaIntegration,
  ResponseType,
  RestApi,
  SecurityPolicy,
} from 'aws-cdk-lib/aws-apigateway';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Architecture, Code, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { ARecord, HostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { ApiGateway } from 'aws-cdk-lib/aws-route53-targets';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import { API_RESOURCE_SERVER, API_USER_SCOPE, USER_POOL_ID_PARAMETER } from './auth-stack.ts';
import { CERTIFICATE_ARN_PARAMETER } from './certificate-stack.ts';
import { ZONE_ID_PARAMETER } from './zone-stack.ts';

// Every method requires this scope. ID tokens have none, so the API accepts only access tokens
// (ADR-0009 §6).
export const API_SCOPE = `${API_RESOURCE_SERVER}/${API_USER_SCOPE}`;

// The stage behind the custom domain. Callers never see its name: the domain maps to it at /.
// CDK's default, "prod", would mislead in dev.
export const API_STAGE = 'live';

// For every method, in requests per second. Well above one person using the web app, and far
// below the account's default of 10,000, so a flood is cut off early (S2-09, AGENTS.md §8).
export const API_THROTTLE = { rateLimit: 5, burstLimit: 10 } as const;

// The only data table calls GET /me makes (apps/api/src/data/profiles.ts).
export const ME_DATA_ACTIONS = ['dynamodb:GetItem', 'dynamodb:PutItem'];

export interface ApiStackProps extends StackProps {
  readonly host: string; // the web app's host; the API is at api.<host>
  readonly tableName: string; // the data table, found by its fixed name (data-stack.ts)
  readonly webOrigin: string; // the one origin CORS allows
  readonly meDirectory: string; // GET /me's build output (apps/api/dist/me)
}

// The API at https://api.<host> (S2-09, ADR-0009 §6): a regional REST API with a Cognito
// authorizer that accepts access tokens only. It holds no data, so it has no termination
// protection, and it can be deleted and created again.
export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    const { host, tableName, webOrigin, meDirectory, ...stackProps } = props;
    super(scope, id, stackProps);

    const domainName = `api.${host}`;

    // GET /me. Same settings as the pre sign-up trigger, except the timeout: two DynamoDB calls
    // with one retry each can take about 7 seconds at worst (handlers/me/handler.ts).
    const me = new LambdaFunction(this, 'Me', {
      description: 'GET /me: who the caller is (S2-09, ADR-0009 section 6)',
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      handler: 'index.handler',
      code: Code.fromAsset(meDirectory), // built by apps/api before AWS credentials exist
      timeout: Duration.seconds(10),
      memorySize: 512, // more memory gives more CPU, so a shorter cold start
      logGroup: new LogGroup(this, 'MeLogs', { retention: RetentionDays.ONE_MONTH }),
      environment: { TABLE_NAME: tableName, ALLOWED_ORIGIN: webOrigin },
      // No reserved concurrency: a new account's limit can be too low to reserve any.
    });

    // Two actions on the data table only. Not table.grantReadWriteData(): that allows about ten,
    // including Query, Scan, and DeleteItem. dynamodb:LeadingKeys can't limit this to the
    // caller's partition: the role is one identity for every user.
    const table = TableV2.fromTableName(this, 'Table', tableName);
    me.addToRolePolicy(
      new PolicyStatement({ actions: ME_DATA_ACTIONS, resources: [table.tableArn] }),
    );

    // The pool ID comes from SSM at deploy time, so no export ties this stack to <env>-Auth.
    const authorizer = new CognitoUserPoolsAuthorizer(this, 'Authorizer', {
      authorizerName: 'cognito-access-tokens',
      cognitoUserPools: [
        UserPool.fromUserPoolId(
          this,
          'UserPool',
          StringParameter.valueForStringParameter(this, USER_POOL_ID_PARAMETER),
        ),
      ],
    });

    const api = new RestApi(this, 'Api', {
      restApiName: 'cv-tailor-api',
      description: `The CV Tailor API at https://${domainName} (S2-09)`,
      endpointConfiguration: { types: [EndpointType.REGIONAL] },
      // The custom domain is the only way in, so the CORS and TLS settings can't be bypassed.
      disableExecuteApiEndpoint: true,
      // An account-wide role for execution logs. Off for now (cdk.json's flag says the same).
      cloudWatchRole: false,
      deployOptions: {
        stageName: API_STAGE,
        throttlingRateLimit: API_THROTTLE.rateLimit,
        throttlingBurstLimit: API_THROTTLE.burstLimit,
      },
      domainName: {
        domainName,
        // *.<host> covers api.<host>. A regional API needs a certificate in its own region:
        // us-east-1, where it is (ADR-0008).
        certificate: Certificate.fromCertificateArn(
          this,
          'Certificate',
          StringParameter.valueForStringParameter(this, CERTIFICATE_ARN_PARAMETER),
        ),
        endpointType: EndpointType.REGIONAL,
        securityPolicy: SecurityPolicy.TLS_1_2,
      },
      // Preflight for the web app's origin only. The authorizer is set per method below, not in
      // defaultMethodOptions, so these OPTIONS methods stay open, as browsers require.
      defaultCorsPreflightOptions: {
        allowOrigins: [webOrigin],
        allowMethods: ['GET'],
        allowHeaders: ['Authorization'], // the only non-simple header a GET sends
        maxAge: Duration.hours(1),
      },
    });

    api.root.addResource('me').addMethod(
      'GET',
      // No test-invoke permission: the console's test button isn't used.
      new LambdaIntegration(me, { allowTestInvoke: false }),
      {
        authorizer,
        authorizationType: AuthorizationType.COGNITO,
        authorizationScopes: [API_SCOPE],
      },
    );

    // API Gateway's own errors: 401 from the authorizer, 403 for an unknown route, 429 when
    // throttled, and 5xx. Without the CORS header, the browser hides them from the web app
    // (ADR-0009 §6). The two defaults cover every type without its own setting.
    const cors = { 'Access-Control-Allow-Origin': `'${webOrigin}'` }; // quoted: a static value
    api.addGatewayResponse('Unauthorized', {
      type: ResponseType.UNAUTHORIZED,
      responseHeaders: cors,
    });
    api.addGatewayResponse('Default4xx', { type: ResponseType.DEFAULT_4XX, responseHeaders: cors });
    api.addGatewayResponse('Default5xx', { type: ResponseType.DEFAULT_5XX, responseHeaders: cors });

    const zone = HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      zoneName: host,
      hostedZoneId: StringParameter.valueForStringParameter(this, ZONE_ID_PARAMETER),
    });
    // An A record only, as for the sign-in domain. No AAAA until IPv6 is turned on for the domain.
    new ARecord(this, 'Alias', {
      zone,
      recordName: domainName,
      target: RecordTarget.fromAlias(new ApiGateway(api)),
    });
  }
}
