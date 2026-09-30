import { describe, expect, test } from 'vitest';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { BudgetStack } from '../lib/budget-stack.ts';
import { testApp } from './test-app.ts';

// Monthly budget (S1-09). The whole resource is matched exactly, so a missing subscriber,
// a threshold type of ABSOLUTE_VALUE, or credits counted against spend all fail here.

describe('Budget stack', () => {
  const stack = new BudgetStack(testApp(), 'Budget', {
    budgetName: 'cv-tailor-dev-monthly',
    monthlyLimitUsd: 100,
    alertEmail: 'dummy@example.com',
  });
  const template = Template.fromStack(stack);

  const alert = (NotificationType: string, Threshold: number) => ({
    Notification: {
      NotificationType,
      ComparisonOperator: 'GREATER_THAN',
      Threshold,
      ThresholdType: 'PERCENTAGE',
    },
    Subscribers: [{ SubscriptionType: 'EMAIL', Address: 'dummy@example.com' }],
  });

  test('creates one monthly cost budget with email alerts at 25/50/80/100% actual and 100% forecast', () => {
    template.resourceCountIs('AWS::Budgets::Budget', 1);
    template.hasResourceProperties(
      'AWS::Budgets::Budget',
      Match.objectEquals({
        Budget: {
          BudgetName: 'cv-tailor-dev-monthly',
          BudgetType: 'COST',
          TimeUnit: 'MONTHLY',
          BudgetLimit: { Amount: 100, Unit: 'USD' },
          CostTypes: { IncludeCredit: false },
        },
        NotificationsWithSubscribers: [
          alert('ACTUAL', 25),
          alert('ACTUAL', 50),
          alert('ACTUAL', 80),
          alert('ACTUAL', 100),
          alert('FORECASTED', 100),
        ],
      }),
    );
  });

  test('has termination protection', () => {
    expect(stack.terminationProtection).toBe(true);
  });
});
