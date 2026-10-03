import { RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { AttributeType, Billing, type CfnGlobalTable, TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import type { Construct } from 'constructs';

// The table's fixed name. S2-09's API stack uses it too (TableV2.fromTableName), so no export ties
// the two stacks together.
export const dataTableName = (environment: string): string => `cv-tailor-${environment}-data`;

export interface DataStackProps extends StackProps {
  readonly tableName: string;
}

// The data table for one environment (S2-08, ADR-0006). It holds user data, so it has PITR,
// deletion protection, a retain policy, termination protection, and a fixed logical ID.
// Other stacks find it by its fixed name, so no export ties them to this stack.
export class DataStack extends Stack {
  constructor(scope: Construct, id: string, props: DataStackProps) {
    const { tableName, ...stackProps } = props;
    super(scope, id, { terminationProtection: true, ...stackProps });

    // TableV2 is a GlobalTable with one replica, billed as a single-region table. Chosen before the
    // table holds data, because CloudFormation can't turn a Table into a GlobalTable in place.
    const table = new TableV2(this, 'Table', {
      tableName,
      // Generic names: the values carry the meaning (apps/api/src/data/keys.ts).
      partitionKey: { name: 'PK', type: AttributeType.STRING },
      sortKey: { name: 'SK', type: AttributeType.STRING },
      billing: Billing.onDemand(), // no cost at zero traffic
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true }, // `pointInTimeRecovery` is deprecated
      timeToLiveAttribute: 'expiresAt', // only items that should expire carry it (quota counters)
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    // A changed logical ID would make CloudFormation try to create a new table. The fixed name
    // makes that fail rather than succeed with an empty table.
    (table.node.defaultChild as CfnGlobalTable).overrideLogicalId('DataTable');
  }
}
