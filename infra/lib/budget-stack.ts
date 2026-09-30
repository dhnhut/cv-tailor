import { Stack, type StackProps } from 'aws-cdk-lib';
import { CfnBudget } from 'aws-cdk-lib/aws-budgets';
import type { Construct } from 'constructs';

// Alert thresholds, as a percentage of the monthly amount (S1-09).
const ACTUAL_THRESHOLDS = [25, 50, 80, 100];
const FORECAST_THRESHOLD = 100;

export interface BudgetStackProps extends StackProps {
  readonly budgetName: string;
  readonly monthlyLimitUsd: number;
  readonly alertEmail: string;
}

// Monthly cost budget for one account (S1-09, AGENTS.md §8).
// Deployed from a laptop in its own stage, so app deploys can't change it.
export class BudgetStack extends Stack {
  constructor(scope: Construct, id: string, props: BudgetStackProps) {
    const { budgetName, monthlyLimitUsd, alertEmail, ...stackProps } = props;
    super(scope, id, { terminationProtection: true, ...stackProps });

    const alert = (notificationType: 'ACTUAL' | 'FORECASTED', threshold: number) => ({
      notification: {
        notificationType,
        comparisonOperator: 'GREATER_THAN',
        threshold,
        thresholdType: 'PERCENTAGE',
      },
      subscribers: [{ subscriptionType: 'EMAIL', address: alertEmail }],
    });

    new CfnBudget(this, 'MonthlyCost', {
      budget: {
        budgetName,
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: monthlyLimitUsd, unit: 'USD' },
        // Credits would hide real usage until they run out, so track spend before credits.
        costTypes: { includeCredit: false },
      },
      notificationsWithSubscribers: [
        ...ACTUAL_THRESHOLDS.map((threshold) => alert('ACTUAL', threshold)),
        alert('FORECASTED', FORECAST_THRESHOLD),
      ],
    });
  }
}
