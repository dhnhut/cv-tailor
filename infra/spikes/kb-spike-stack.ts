import { CfnOutput, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { CfnDataSource, CfnKnowledgeBase } from 'aws-cdk-lib/aws-bedrock';
import { PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';

// S2-12 spike (ADR-0007): a Bedrock Managed Knowledge Base with an ACL-enabled S3 data source.
// Not part of createApp(), so CI never deploys it. Deployed from a laptop and destroyed after
// the spike (spikes/kb-spike.ts). Sprint 3's knowledge base stack replaces this folder.
export const KB_SPIKE_STACK_NAME = 'dev-KbSpike';

export class KbSpikeStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Spike data only, so it's deleted with the stack.
    const bucket = new Bucket(this, 'Documents', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

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
      name: 'cv-tailor-dev-kb-spike',
      roleArn: role.roleArn,
      knowledgeBaseConfiguration: {
        type: 'MANAGED',
        managedKnowledgeBaseConfiguration: { embeddingModelType: 'MANAGED' },
      },
    });
    // Depends on the role's DefaultPolicy too, so the S3 permissions exist before Bedrock uses the role.
    knowledgeBase.node.addDependency(role);

    const dataSource = new CfnDataSource(this, 'DataSource', {
      knowledgeBaseId: knowledgeBase.attrKnowledgeBaseId,
      name: 'documents',
      dataDeletionPolicy: 'DELETE',
      dataSourceConfiguration: {
        type: 'MANAGED_KNOWLEDGE_BASE_CONNECTOR',
        managedKnowledgeBaseConnectorConfiguration: {
          // Free-form JSON in CloudFormation and CDK: nothing checks these names before deploy,
          // so the test pins them. aclEnabled: a document without an ACL is not ingested.
          connectorParameters: {
            type: 'S3',
            version: '1',
            aclEnabled: true,
            connectionConfiguration: {
              bucketName: bucket.bucketName,
              bucketOwnerAccountId: this.account,
            },
          },
        },
      },
    });

    new CfnOutput(this, 'KnowledgeBaseId', { value: knowledgeBase.attrKnowledgeBaseId });
    new CfnOutput(this, 'DataSourceId', { value: dataSource.attrDataSourceId });
    new CfnOutput(this, 'BucketName', { value: bucket.bucketName });
  }
}
