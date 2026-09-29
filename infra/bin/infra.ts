import { App } from 'aws-cdk-lib';
import { AccessStage } from '../lib/access-stage.ts';
import { CvTailorStage } from '../lib/cv-tailor-stage.ts';
import { loadEnvironments } from '../config/environments.ts';

const app = new App();

for (const config of loadEnvironments()) {
  new CvTailorStage(app, config.name, { config });
  new AccessStage(app, `${config.name}-access`, { config });
}
