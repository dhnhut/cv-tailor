import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { KILL_SWITCH_PARAMETER, KillSwitchStack } from '../lib/kill-switch-stack.ts';
import { testApp } from './test-app.ts';

// The kill switch parameter (S2-11, ADMIN-03). Every property is matched exactly, including the
// description. CloudFormation writes the committed initial value back whenever it updates this
// resource (kill switch runbook), so a change to any property must show up here and be reviewed.

const synth = (initialValue: 'enabled' | 'disabled') => {
  const stack = new KillSwitchStack(testApp(), 'KillSwitch', { initialValue });
  return { stack, template: Template.fromStack(stack) };
};

describe.each(['enabled', 'disabled'] as const)(
  'Kill switch stack, starting %s',
  (initialValue) => {
    const { stack, template } = synth(initialValue);

    test('creates exactly one parameter, /cv-tailor/ai-calls, holding the initial value', () => {
      template.resourceCountIs('AWS::SSM::Parameter', 1);
      template.hasResourceProperties(
        'AWS::SSM::Parameter',
        Match.objectEquals({
          Name: '/cv-tailor/ai-calls',
          Type: 'String',
          Value: initialValue,
          AllowedPattern: '^(enabled|disabled)$',
          Tier: 'Standard',
          Description:
            'Kill switch for every AI call (ADMIN-03). See docs/runbooks/kill-switch.md.',
        }),
      );
    });

    test('has termination protection', () => {
      expect(stack.terminationProtection).toBe(true);
    });
  },
);

// SSM checks every put-parameter value against AllowedPattern, so a typo fails instead of
// silently turning AI off. The pattern is read from the template, so this tests what deploys.
// It uses no syntax that differs between regex engines; the live check (step 10) confirms
// that SSM rejects a typo.
describe('the allowed pattern', () => {
  const [parameter] = Object.values(synth('enabled').template.findResources('AWS::SSM::Parameter'));
  const pattern = new RegExp(
    (parameter as { Properties: { AllowedPattern: string } }).Properties.AllowedPattern,
  );

  test.each(['enabled', 'disabled'])('accepts %j', (value) => {
    expect(pattern.test(value)).toBe(true);
  });

  // Without the anchors, 'enabledx' and ' enabled' would pass.
  test.each(['Enabled', 'DISABLED', 'enabled ', ' disabled', 'enabledx', 'off', 'true', ''])(
    'rejects %j',
    (value) => {
      expect(pattern.test(value)).toBe(false);
    },
  );
});

// The guard in services/agents reads the parameter by its name. If the two names drifted apart,
// the guard couldn't find the parameter and would block every AI call (fail closed), and only
// the live check would notice.
test('the AI call guard reads the same parameter name', () => {
  const guard = readFileSync(
    new URL('../../services/agents/src/cv_tailor_agents/ai_guard/kill_switch.py', import.meta.url),
    'utf8',
  );
  expect(guard).toContain(`PARAMETER_NAME = "${KILL_SWITCH_PARAMETER}"`);
});
