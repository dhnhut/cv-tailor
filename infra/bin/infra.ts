import { App } from 'aws-cdk-lib';
import { HelloStack } from '../lib/hello-stack.ts';

const app = new App();

new HelloStack(app, 'CvTailor-Hello', {
  env: { region: 'us-east-1' }, // single region, ADR-0002
});
