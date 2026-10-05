import { describe, expect, test } from 'vitest';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { KbSpikeStack } from '../spikes/kb-spike-stack.ts';
import { testApp } from './test-app.ts';

// S2-12 spike, ADR-0007 verification step 1: the synthesised template has a managed knowledge
// base with an ACL-enabled S3 data source. connectorParameters is free-form JSON that no schema
// checks before deploy, so it is matched exactly here.
const template = Template.fromStack(new KbSpikeStack(testApp(), 'KbSpike'));

describe('KB spike stack', () => {
  test('creates one managed knowledge base with managed embedding', () => {
    template.resourceCountIs('AWS::Bedrock::KnowledgeBase', 1);
    template.hasResourceProperties('AWS::Bedrock::KnowledgeBase', {
      KnowledgeBaseConfiguration: Match.objectEquals({
        Type: 'MANAGED',
        ManagedKnowledgeBaseConfiguration: { EmbeddingModelType: 'MANAGED' },
      }),
      StorageConfiguration: Match.absent(),
    });
  });

  test('has one S3 data source with ACL awareness on', () => {
    template.resourceCountIs('AWS::Bedrock::DataSource', 1);
    template.hasResourceProperties('AWS::Bedrock::DataSource', {
      DataDeletionPolicy: 'DELETE',
      DataSourceConfiguration: {
        Type: 'MANAGED_KNOWLEDGE_BASE_CONNECTOR',
        ManagedKnowledgeBaseConnectorConfiguration: {
          ConnectorParameters: Match.objectEquals({
            type: 'S3',
            version: '1',
            aclEnabled: true,
            connectionConfiguration: {
              bucketName: Match.anyValue(),
              bucketOwnerAccountId: Match.anyValue(),
            },
          }),
        },
      },
    });
  });

  test('lets the service role only list the bucket and read its objects', () => {
    const policies = Object.values(template.findResources('AWS::IAM::Policy'));
    const actions = policies.flatMap((policy) =>
      (
        policy as { Properties: { PolicyDocument: { Statement: { Action: string }[] } } }
      ).Properties.PolicyDocument.Statement.map((statement) => statement.Action),
    );
    // The bucket's auto-delete custom resource has its own role, with an inline policy, not an
    // AWS::IAM::Policy. If its shape differs, this assertion is narrowed to the knowledge base role.
    expect(actions.sort()).toEqual(['s3:GetObject', 's3:ListBucket']);
  });

  test('trusts only Bedrock, for knowledge bases in this account', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Principal: { Service: 'bedrock.amazonaws.com' },
            Condition: {
              StringEquals: { 'aws:SourceAccount': Match.anyValue() },
              ArnLike: { 'aws:SourceArn': Match.anyValue() },
            },
          }),
        ],
      },
    });
  });
});
