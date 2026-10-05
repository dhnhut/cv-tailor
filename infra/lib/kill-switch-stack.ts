import { Stack, type StackProps } from 'aws-cdk-lib';
import { ParameterTier, StringParameter } from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import type { AiCallsSwitch } from '../config/environments.ts';

// Read by the AI call guard (services/agents, cv_tailor_agents/ai_guard/kill_switch.py).
export const KILL_SWITCH_PARAMETER = '/cv-tailor/ai-calls';

export interface KillSwitchStackProps extends StackProps {
  readonly initialValue: AiCallsSwitch;
}

// The kill switch (S2-11, ADMIN-03). It's in the baseline stage, which is deployed from a laptop
// only, so a CI deploy can't reset it. CloudFormation writes Value when it creates the parameter,
// and again whenever it updates this resource. A deploy that leaves the resource unchanged keeps
// the value set with `aws ssm put-parameter` (kill switch runbook).
export class KillSwitchStack extends Stack {
  constructor(scope: Construct, id: string, props: KillSwitchStackProps) {
    const { initialValue, ...stackProps } = props;
    super(scope, id, { terminationProtection: true, ...stackProps });

    new StringParameter(this, 'AiCalls', {
      parameterName: KILL_SWITCH_PARAMETER,
      stringValue: initialValue,
      // SSM rejects any other value, so a typo in put-parameter fails loudly.
      allowedPattern: '^(enabled|disabled)$',
      tier: ParameterTier.STANDARD,
      description: 'Kill switch for every AI call (ADMIN-03). See docs/runbooks/kill-switch.md.',
    });
  }
}
