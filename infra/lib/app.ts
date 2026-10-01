import { App, type AppProps } from 'aws-cdk-lib';
import { loadEnvironments } from '../config/environments.ts';
import { AccessStage } from './access-stage.ts';
import { BaselineStage } from './baseline-stage.ts';
import { CvTailorStage } from './cv-tailor-stage.ts';

// Builds every stage for every environment. bin/infra.ts and the tests share this, so
// tests check the same wiring that `cdk synth` runs.
export function createApp(
  env: Record<string, string | undefined> = process.env,
  props?: AppProps,
): App {
  const app = new App(props);
  for (const config of loadEnvironments(env)) {
    new CvTailorStage(app, config.name, { config });
    new AccessStage(app, `${config.name}-access`, { config });
    new BaselineStage(app, `${config.name}-baseline`, { config });
  }
  return app;
}
