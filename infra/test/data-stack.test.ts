import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, test } from 'vitest';
import { DataStack, dataTableName } from '../lib/data-stack.ts';
import { testApp } from './test-app.ts';

// The data table (S2-08, ADR-0006 and its verification step 1). Expected values are written out
// literally, so changing a setting in the code also fails here. The stack gets us-east-1, as in
// its real stage: without a region, the replica's region would be a token.

describe('Data stack', () => {
  const stack = new DataStack(testApp(), 'Data', {
    tableName: 'cv-tailor-dev-data',
    env: { account: '111111111111', region: 'us-east-1' },
  });
  const template = Template.fromStack(stack);

  test('names the table after its environment', () => {
    expect(dataTableName('dev')).toBe('cv-tailor-dev-data');
  });

  test('has termination protection', () => {
    expect(stack.terminationProtection).toBe(true);
  });

  // A new logical ID or a replacement would leave every user's data in a table nothing points at.
  test('keeps one table, with a fixed logical ID, through deletion and replacement', () => {
    expect(Object.keys(template.findResources('AWS::DynamoDB::GlobalTable'))).toEqual([
      'DataTable',
    ]);
    template.resourceCountIs('AWS::DynamoDB::Table', 0);
    template.hasResource('AWS::DynamoDB::GlobalTable', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
  });

  // objectEquals: any property added later (an index, a stream, a KMS key, provisioned capacity,
  // a second replica) fails here, so it needs a decision first.
  test('is on-demand, keyed by PK and SK, with TTL on expiresAt, in one us-east-1 replica with PITR and deletion protection', () => {
    template.hasResourceProperties(
      'AWS::DynamoDB::GlobalTable',
      Match.objectEquals({
        TableName: 'cv-tailor-dev-data',
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: [
          { AttributeName: 'PK', AttributeType: 'S' },
          { AttributeName: 'SK', AttributeType: 'S' },
        ],
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
        TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
        // A GlobalTable sets PITR and deletion protection per replica, not on the table.
        Replicas: [
          {
            Region: 'us-east-1',
            PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
            DeletionProtectionEnabled: true,
          },
        ],
      }),
    );
  });

  // No role, policy, or custom resource rides along with the table.
  test('holds only the table', () => {
    const types = Object.values(template.toJSON().Resources as Record<string, { Type: string }>)
      .map((resource) => resource.Type)
      .filter((type) => type !== 'AWS::CDK::Metadata'); // added by testApp(), as `cdk synth` does
    expect(types).toEqual(['AWS::DynamoDB::GlobalTable']);
  });
});
