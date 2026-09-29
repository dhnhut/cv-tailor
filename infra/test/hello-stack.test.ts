import { Template } from 'aws-cdk-lib/assertions';
import { expect, test } from 'vitest';
import { HelloStack } from '../lib/hello-stack.ts';
import { testApp } from './test-app.ts';

test('hello stack outputs a greeting and creates no resources of its own', () => {
  const stack = new HelloStack(testApp(), 'TestHello');

  const template = Template.fromStack(stack);
  const { Resources } = template.toJSON() as { Resources: Record<string, { Type: string }> };

  template.hasOutput('Message', { Value: 'hello from cv-tailor' });
  // CDKMetadata is the only resource. It also keeps the template valid:
  // CloudFormation rejects a template with an empty Resources section.
  expect(Object.values(Resources).map((r) => r.Type)).toEqual(['AWS::CDK::Metadata']);
});
