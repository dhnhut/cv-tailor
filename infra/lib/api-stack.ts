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
import { DOCUMENTS_KEY_PREFIX } from '@cv-tailor/contracts';
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

// Exactly the table calls each document Lambda makes (apps/api/src/data/documents.ts, S3-07).
// TransactWriteItems has no IAM action of its own: its Put, Update, and Delete need PutItem,
// UpdateItem, and DeleteItem (DynamoDB developer guide, "Using IAM with DynamoDB transactions").
// POST and GET both run the lazy release, which marks, deletes, and frees items.
export const CREATE_DOCUMENT_DATA_ACTIONS = [
  'dynamodb:DeleteItem',
  'dynamodb:GetItem',
  'dynamodb:PutItem',
  'dynamodb:Query',
  'dynamodb:UpdateItem',
];
export const LIST_DOCUMENTS_DATA_ACTIONS = [
  'dynamodb:DeleteItem',
  'dynamodb:GetItem',
  'dynamodb:Query',
  'dynamodb:UpdateItem',
];
export const DELETE_DOCUMENT_DATA_ACTIONS = [
  'dynamodb:DeleteItem',
  'dynamodb:GetItem',
  'dynamodb:UpdateItem',
];

export interface ApiStackProps extends StackProps {
  readonly host: string; // the web app's host; the API is at api.<host>
  readonly tableName: string; // the data table, found by its fixed name (data-stack.ts)
  readonly webOrigin: string; // the one origin CORS allows
  readonly meDirectory: string; // GET /me's build output (apps/api/dist/me)
  readonly documentsBucketName: string; // knowledge-base-stack.ts documentsBucketName()
  readonly createDocumentDirectory: string; // apps/api/dist/create-document
  readonly listDocumentsDirectory: string; // apps/api/dist/list-documents
  readonly deleteDocumentDirectory: string; // apps/api/dist/delete-document
}

// The API at https://api.<host> (S2-09, ADR-0009 §6): a regional REST API with a Cognito
// authorizer that accepts access tokens only. It holds no data, so it has no termination
// protection, and it can be deleted and created again.
export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    const {
      host,
      tableName,
      webOrigin,
      meDirectory,
      documentsBucketName,
      createDocumentDirectory,
      listDocumentsDirectory,
      deleteDocumentDirectory,
      ...stackProps
    } = props;
    super(scope, id, stackProps);

    const domainName = `api.${host}`;

    // Every API Lambda: Node.js 24 on arm64, a prebuilt bundle (built by apps/api before AWS
    // credentials exist), and a one-month log. The logical IDs (Me, MeLogs, ...) stay fixed, so
    // nothing is replaced. No reserved concurrency: a new account's limit can be too low.
    const apiFunction = (
      id: string,
      description: string,
      directory: string,
      timeout: Duration,
      environment: Record<string, string>,
    ) =>
      new LambdaFunction(this, id, {
        description,
        runtime: Runtime.NODEJS_24_X,
        architecture: Architecture.ARM_64,
        handler: 'index.handler',
        code: Code.fromAsset(directory),
        timeout,
        memorySize: 512, // more memory gives more CPU, so a shorter cold start
        logGroup: new LogGroup(this, `${id}Logs`, { retention: RetentionDays.ONE_MONTH }),
        environment,
      });

    // GET /me. Two DynamoDB calls with one retry each can take about 7 seconds at worst
    // (handlers/me/handler.ts).
    const me = apiFunction(
      'Me',
      'GET /me: who the caller is (S2-09, ADR-0009 section 6)',
      meDirectory,
      Duration.seconds(10),
      { TABLE_NAME: tableName, ALLOWED_ORIGIN: webOrigin },
    );

    // The document API (S3-07). POST and GET make up to about 8 calls at worst (list, the lazy
    // release, the transaction, the ACL file), each with one retry: well under API Gateway's
    // 29-second limit.
    const documentsEnvironment = {
      TABLE_NAME: tableName,
      BUCKET_NAME: documentsBucketName,
      ALLOWED_ORIGIN: webOrigin,
    };
    const createDocument = apiFunction(
      'CreateDocument',
      'POST /documents: reserve storage and return a presigned upload (S3-07)',
      createDocumentDirectory,
      Duration.seconds(20),
      documentsEnvironment,
    );
    const listDocuments = apiFunction(
      'ListDocuments',
      "GET /documents: the caller's documents and usage (S3-07)",
      listDocumentsDirectory,
      Duration.seconds(20),
      documentsEnvironment,
    );
    const deleteDocument = apiFunction(
      'DeleteDocument',
      'DELETE /documents/{id}: remove a document and free its bytes (S3-07)',
      deleteDocumentDirectory,
      Duration.seconds(15),
      documentsEnvironment,
    );

    // Two actions on the data table only. Not table.grantReadWriteData(): that allows about ten,
    // including Query, Scan, and DeleteItem. dynamodb:LeadingKeys can't limit this to the
    // caller's partition: the role is one identity for every user.
    const table = TableV2.fromTableName(this, 'Table', tableName);
    me.addToRolePolicy(
      new PolicyStatement({ actions: ME_DATA_ACTIONS, resources: [table.tableArn] }),
    );

    // The documents bucket, by its fixed name: plain ARNs, no SSM lookup. The role is one identity
    // for every user, so it can't be limited to the caller's kb/<sub>/. The code builds every key
    // from the verified sub (apps/api/src/storage/keys.ts). PutObject covers both the ACL file and
    // the presigned URL, which S3 checks against the signing role.
    const bucketArn = `arn:aws:s3:::${documentsBucketName}`;
    const documentsArn = `${bucketArn}/${DOCUMENTS_KEY_PREFIX}*`;
    const listDocumentKeys = () =>
      new PolicyStatement({
        actions: ['s3:ListBucket'],
        resources: [bucketArn],
        conditions: { StringLike: { 's3:prefix': `${DOCUMENTS_KEY_PREFIX}*` } },
      });
    const dataActions = (actions: string[]) =>
      new PolicyStatement({ actions, resources: [table.tableArn] });
    const objectActions = (actions: string[]) =>
      new PolicyStatement({ actions, resources: [documentsArn] });

    createDocument.addToRolePolicy(dataActions(CREATE_DOCUMENT_DATA_ACTIONS));
    createDocument.addToRolePolicy(objectActions(['s3:DeleteObject', 's3:PutObject']));
    createDocument.addToRolePolicy(listDocumentKeys());
    listDocuments.addToRolePolicy(dataActions(LIST_DOCUMENTS_DATA_ACTIONS));
    listDocuments.addToRolePolicy(objectActions(['s3:DeleteObject']));
    listDocuments.addToRolePolicy(listDocumentKeys());
    deleteDocument.addToRolePolicy(dataActions(DELETE_DOCUMENT_DATA_ACTIONS));
    deleteDocument.addToRolePolicy(objectActions(['s3:DeleteObject']));

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
        allowMethods: ['GET', 'POST', 'DELETE'],
        allowHeaders: ['Authorization', 'Content-Type'], // POST /documents sends JSON
        maxAge: Duration.hours(1),
      },
    });

    // Every method needs an access token with the API scope. No test-invoke permission: the
    // console's test button isn't used.
    const methodOptions = {
      authorizer,
      authorizationType: AuthorizationType.COGNITO,
      authorizationScopes: [API_SCOPE],
    };
    const integration = (fn: LambdaFunction) =>
      new LambdaIntegration(fn, { allowTestInvoke: false });

    api.root.addResource('me').addMethod('GET', integration(me), methodOptions);

    const documents = api.root.addResource('documents');
    documents.addMethod('GET', integration(listDocuments), methodOptions);
    documents.addMethod('POST', integration(createDocument), methodOptions);
    documents.addResource('{id}').addMethod('DELETE', integration(deleteDocument), methodOptions);

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
