import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { expect, test } from 'vitest';
import { HelloStack } from '../lib/hello-stack.ts';

test('hello stack outputs a greeting and creates no resources', () => {
  const app = new App();
  const stack = new HelloStack(app, 'TestHello');

  const template = Template.fromStack(stack);

  template.hasOutput('Message', { Value: 'hello from cv-tailor' });
  expect(template.toJSON()).not.toHaveProperty('Resources');
});
