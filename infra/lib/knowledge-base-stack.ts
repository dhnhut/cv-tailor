import { Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { CfnDataSource, CfnKnowledgeBase } from 'aws-cdk-lib/aws-bedrock';
import { AnyPrincipal, Effect, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  type CfnBucket,
  HttpMethods,
  ObjectOwnership,
} from 'aws-cdk-lib/aws-s3';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';

// Read at deploy time by the API (S3-07) and the agent runtime (S3-10), so no CloudFormation
// export ties them to this stack.
export const KNOWLEDGE_BASE_ID_PARAMETER = '/cv-tailor/knowledge-base/id';
export const DATA_SOURCE_ID_PARAMETER = '/cv-tailor/knowledge-base/data-source-id';
export const DOCUMENTS_BUCKET_PARAMETER = '/cv-tailor/knowledge-base/bucket-name';

// KB-03: the largest file a candidate can upload. The connector skips anything bigger.
export const MAX_FILE_SIZE_MB = 50;

// Old versions of a document are kept as long as PITR keeps the table's items (S2-08).
export const NONCURRENT_VERSION_DAYS = 35;

// Bucket names are global, so the account ID keeps another account from taking the name first.
export const documentsBucketName = (environment: string, account: string): string =>
  `cv-tailor-${environment}-documents-${account}`;

export interface KnowledgeBaseStackProps extends StackProps {
  readonly bucketName: string;
  readonly knowledgeBaseName: string;
  readonly webOrigin: string; // the only origin that may upload directly (KB-04)
}

// The knowledge base for one environment (S3-06, ADR-0007): the documents bucket, a Bedrock
// Managed Knowledge Base, and an ACL-enabled S3 data source. The bucket holds user data, so it
// has the data table's guards: retain policy, fixed name and logical ID, versioning (as PITR),
// a deny on DeleteBucket (as deletion protection), and termination protection.
export class KnowledgeBaseStack extends Stack {
  constructor(scope: Construct, id: string, props: KnowledgeBaseStackProps) {
    const { bucketName, knowledgeBaseName, webOrigin, ...stackProps } = props;
    super(scope, id, { terminationProtection: true, ...stackProps });

    const bucket = new Bucket(this, 'Documents', {
      bucketName,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED, // no object ACLs
      encryption: BucketEncryption.S3_MANAGED, // no fixed cost, no key policy for Bedrock
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [
        {
          id: 'ExpireOldVersions',
          noncurrentVersionExpiration: Duration.days(NONCURRENT_VERSION_DAYS),
          expiredObjectDeleteMarker: true, // tidy up once a deleted document's versions are gone
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
      ],
      // The browser uploads with a presigned PUT (S3-07), sending the two signed headers below.
      cors: [
        {
          allowedOrigins: [webOrigin],
          allowedMethods: [HttpMethods.PUT],
          allowedHeaders: ['content-type', 'x-amz-checksum-sha256'],
          maxAge: 3600,
        },
      ],
      removalPolicy: RemovalPolicy.RETAIN,
    });
    // A changed logical ID would make CloudFormation try to create a new bucket. The fixed name
    // makes that fail rather than succeed with an empty bucket.
    (bucket.node.defaultChild as CfnBucket).overrideLogicalId('DocumentsBucket');
    // S3 has no deletion protection, so this deny plays its part. To delete the bucket on purpose,
    // remove this statement first.
    bucket.addToResourcePolicy(
      new PolicyStatement({
        sid: 'DenyBucketDeletion',
        effect: Effect.DENY,
        principals: [new AnyPrincipal()],
        actions: ['s3:DeleteBucket'],
        resources: [bucket.bucketArn],
      }),
    );

    // AWS's documented service role for a managed knowledge base with an S3 source
    // (kb-managed-permissions). Managed embedding and reranking need no model permissions.
    const role = new Role(this, 'KnowledgeBaseRole', {
      assumedBy: new ServicePrincipal('bedrock.amazonaws.com', {
        conditions: {
          StringEquals: { 'aws:SourceAccount': this.account },
          ArnLike: {
            'aws:SourceArn': `arn:aws:bedrock:${this.region}:${this.account}:knowledge-base/*`,
          },
        },
      }),
    });
    const sameAccount = { StringEquals: { 'aws:ResourceAccount': this.account } };
    role.addToPolicy(
      new PolicyStatement({
        actions: ['s3:ListBucket'],
        resources: [bucket.bucketArn],
        conditions: sameAccount,
      }),
    );
    role.addToPolicy(
      new PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [bucket.arnForObjects('*')],
        conditions: sameAccount,
      }),
    );

    const knowledgeBase = new CfnKnowledgeBase(this, 'KnowledgeBase', {
      name: knowledgeBaseName,
      description: 'Candidate documents, with one ACL per document (ADR-0007)',
      roleArn: role.roleArn,
      knowledgeBaseConfiguration: {
        type: 'MANAGED',
        managedKnowledgeBaseConfiguration: { embeddingModelType: 'MANAGED' },
      },
    });
    // Depends on the role's DefaultPolicy too, so the S3 permissions exist before Bedrock uses the role.
    knowledgeBase.node.addDependency(role);

    // No vectorIngestionConfiguration: the default chunking can't be changed after creation, so a
    // change means a new data source (ADR-0007).
    const dataSource = new CfnDataSource(this, 'DataSource', {
      knowledgeBaseId: knowledgeBase.attrKnowledgeBaseId,
      name: 'documents',
      dataDeletionPolicy: 'DELETE', // the index is rebuilt from the bucket, so nothing is lost
      dataSourceConfiguration: {
        type: 'MANAGED_KNOWLEDGE_BASE_CONNECTOR',
        managedKnowledgeBaseConnectorConfiguration: {
          // Free-form JSON in CloudFormation and CDK: nothing checks these names before deploy,
          // so the test pins them. aclEnabled can't change after creation, and a document
          // without an ACL is not ingested.
          connectorParameters: {
            type: 'S3',
            version: '1',
            aclEnabled: true,
            connectionConfiguration: {
              bucketName: bucket.bucketName,
              bucketOwnerAccountId: this.account,
            },
            // A numeric string, as the connector expects. The service default is "500".
            filterConfiguration: { maxFileSizeInMegaBytes: String(MAX_FILE_SIZE_MB) },
          },
          // KB-03 allows no media types, and images inside a PDF or DOCX (such as a CV photo)
          // are personal data the agents don't need (SAFE-04). The service turns image
          // extraction on by default.
          mediaExtractionConfiguration: {
            imageExtractionConfiguration: { imageExtractionStatus: 'DISABLED' },
            audioExtractionConfiguration: { audioExtractionStatus: 'DISABLED' },
            videoExtractionConfiguration: { videoExtractionStatus: 'DISABLED' },
          },
          // Deletion protection skips a sync's delete phase when it would delete more than a
          // share of the index. With one shared knowledge base and few documents, one
          // candidate's delete can pass it, and the deleted document would stay retrievable.
          // The bucket's versioning guards against bulk deletion instead.
          deletionProtectionConfiguration: { deletionProtectionStatus: 'DISABLED' },
        },
      },
    });

    new StringParameter(this, 'KnowledgeBaseIdParameter', {
      parameterName: KNOWLEDGE_BASE_ID_PARAMETER,
      description: `ID of the ${knowledgeBaseName} knowledge base (S3-06)`,
      stringValue: knowledgeBase.attrKnowledgeBaseId,
    });
    new StringParameter(this, 'DataSourceIdParameter', {
      parameterName: DATA_SOURCE_ID_PARAMETER,
      description: `ID of the documents data source in ${knowledgeBaseName} (S3-06)`,
      stringValue: dataSource.attrDataSourceId,
    });
    new StringParameter(this, 'DocumentsBucketParameter', {
      parameterName: DOCUMENTS_BUCKET_PARAMETER,
      description: 'Name of the candidate documents bucket (S3-06)',
      stringValue: bucket.bucketName,
    });
  }
}
