import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, test } from 'vitest';
import {
  DATA_SOURCE_ID_PARAMETER,
  DOCUMENTS_BUCKET_PARAMETER,
  KNOWLEDGE_BASE_ID_PARAMETER,
  KnowledgeBaseStack,
  documentsBucketName,
} from '../lib/knowledge-base-stack.ts';
import { testApp } from './test-app.ts';

// The knowledge base stack (S3-06, ADR-0007). Expected values are written out literally, so
// changing a setting in the code also fails here.

describe('Knowledge base stack', () => {
  const stack = new KnowledgeBaseStack(testApp(), 'KnowledgeBase', {
    bucketName: 'cv-tailor-dev-documents-111111111111',
    knowledgeBaseName: 'cv-tailor-dev-kb',
    webOrigin: 'https://dev.cv.ikiwii.com',
    env: { account: '111111111111', region: 'us-east-1' },
  });
  const template = Template.fromStack(stack);

  test('names the bucket after its environment and account', () => {
    expect(documentsBucketName('dev', '111111111111')).toBe('cv-tailor-dev-documents-111111111111');
  });

  test('has termination protection', () => {
    expect(stack.terminationProtection).toBe(true);
  });

  // A new logical ID or a replacement would leave every candidate's documents in a bucket nothing
  // points at.
  test('keeps one bucket, with a fixed logical ID, through deletion and replacement', () => {
    expect(Object.keys(template.findResources('AWS::S3::Bucket'))).toEqual(['DocumentsBucket']);
    template.hasResource('AWS::S3::Bucket', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
  });

  // objectEquals: any property added later (logging, notifications, a KMS key) fails here.
  test('is private, encrypted, versioned, and accepts uploads from the web app only', () => {
    template.hasResourceProperties(
      'AWS::S3::Bucket',
      Match.objectEquals({
        BucketName: 'cv-tailor-dev-documents-111111111111',
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
        OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] },
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
          ],
        },
        VersioningConfiguration: { Status: 'Enabled' },
        LifecycleConfiguration: {
          Rules: [
            {
              Id: 'ExpireOldVersions',
              Status: 'Enabled',
              NoncurrentVersionExpiration: { NoncurrentDays: 35 },
              ExpiredObjectDeleteMarker: true,
              AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
            },
          ],
        },
        CorsConfiguration: {
          CorsRules: [
            {
              AllowedOrigins: ['https://dev.cv.ikiwii.com'],
              AllowedMethods: ['POST', 'PUT'],
              AllowedHeaders: ['content-type', 'x-amz-checksum-sha256'],
              MaxAge: 3600,
            },
          ],
        },
      }),
    );
  });

  test('refuses plain HTTP and bucket deletion to everyone', () => {
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Action: 's3:*',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
          Match.objectLike({
            Sid: 'DenyBucketDeletion',
            Effect: 'Deny',
            Principal: { AWS: '*' },
            Action: 's3:DeleteBucket',
          }),
        ]),
      },
    });
  });

  test('creates one managed knowledge base with managed embedding', () => {
    template.resourceCountIs('AWS::Bedrock::KnowledgeBase', 1);
    template.hasResourceProperties(
      'AWS::Bedrock::KnowledgeBase',
      Match.objectEquals({
        Name: 'cv-tailor-dev-kb',
        Description: Match.anyValue(),
        RoleArn: Match.anyValue(),
        KnowledgeBaseConfiguration: {
          Type: 'MANAGED',
          ManagedKnowledgeBaseConfiguration: { EmbeddingModelType: 'MANAGED' },
        },
      }),
    );
  });

  // connectorParameters is free-form JSON that no schema checks before deploy (S2-12), and
  // aclEnabled and chunking can't change after creation, so the whole data source is pinned.
  test('has one S3 data source: ACLs on, 50 MB filter, no media extraction, no deletion protection', () => {
    template.resourceCountIs('AWS::Bedrock::DataSource', 1);
    template.hasResourceProperties(
      'AWS::Bedrock::DataSource',
      Match.objectEquals({
        KnowledgeBaseId: { 'Fn::GetAtt': ['KnowledgeBase', 'KnowledgeBaseId'] },
        Name: 'documents',
        DataDeletionPolicy: 'DELETE',
        DataSourceConfiguration: {
          Type: 'MANAGED_KNOWLEDGE_BASE_CONNECTOR',
          ManagedKnowledgeBaseConnectorConfiguration: {
            ConnectorParameters: {
              type: 'S3',
              version: '1',
              aclEnabled: true,
              connectionConfiguration: {
                bucketName: { Ref: 'DocumentsBucket' },
                bucketOwnerAccountId: '111111111111',
              },
              filterConfiguration: { maxFileSizeInMegaBytes: '50' },
            },
            MediaExtractionConfiguration: {
              ImageExtractionConfiguration: { ImageExtractionStatus: 'DISABLED' },
              AudioExtractionConfiguration: { AudioExtractionStatus: 'DISABLED' },
              VideoExtractionConfiguration: { VideoExtractionStatus: 'DISABLED' },
            },
            DeletionProtectionConfiguration: { DeletionProtectionStatus: 'DISABLED' },
          },
        },
      }),
    );
  });

  test('lets the service role only list the bucket and read its objects', () => {
    const actions = Object.values(template.findResources('AWS::IAM::Policy')).flatMap((policy) =>
      (
        policy as { Properties: { PolicyDocument: { Statement: { Action: string }[] } } }
      ).Properties.PolicyDocument.Statement.map((statement) => statement.Action),
    );
    expect(actions.sort()).toEqual(['s3:GetObject', 's3:ListBucket']);
  });

  test('trusts only Bedrock, for knowledge bases in this account', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Principal: { Service: 'bedrock.amazonaws.com' },
            Condition: {
              StringEquals: { 'aws:SourceAccount': '111111111111' },
              ArnLike: {
                'aws:SourceArn': 'arn:aws:bedrock:us-east-1:111111111111:knowledge-base/*',
              },
            },
          }),
        ],
      },
    });
  });

  test('writes the knowledge base ID, data source ID, and bucket name to SSM', () => {
    const values = Object.values(template.findResources('AWS::SSM::Parameter')).map(
      (parameter) => (parameter as { Properties: { Name: string; Value: unknown } }).Properties,
    );
    expect(values.map(({ Name, Value }) => ({ Name, Value }))).toEqual([
      {
        Name: KNOWLEDGE_BASE_ID_PARAMETER,
        Value: { 'Fn::GetAtt': ['KnowledgeBase', 'KnowledgeBaseId'] },
      },
      { Name: DATA_SOURCE_ID_PARAMETER, Value: { 'Fn::GetAtt': ['DataSource', 'DataSourceId'] } },
      { Name: DOCUMENTS_BUCKET_PARAMETER, Value: { Ref: 'DocumentsBucket' } },
    ]);
  });

  // No custom resource (such as auto-delete) or extra role rides along.
  test('holds only the expected resources', () => {
    const types = Object.values(template.toJSON().Resources as Record<string, { Type: string }>)
      .map((resource) => resource.Type)
      .filter((type) => type !== 'AWS::CDK::Metadata')
      .sort();
    expect(types).toEqual([
      'AWS::Bedrock::DataSource',
      'AWS::Bedrock::KnowledgeBase',
      'AWS::IAM::Policy',
      'AWS::IAM::Role',
      'AWS::S3::Bucket',
      'AWS::S3::BucketPolicy',
      'AWS::SSM::Parameter',
      'AWS::SSM::Parameter',
      'AWS::SSM::Parameter',
    ]);
  });
});
