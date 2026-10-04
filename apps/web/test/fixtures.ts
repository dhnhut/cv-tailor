import type { WebConfig } from '@cv-tailor/contracts';

// A config.json for dev, in Cognito's real formats, so WebConfig.parse accepts it. The client ID
// has Cognito's usual shape: 26 lowercase letters and digits.
export const DEV_CONFIG: WebConfig = {
  environment: 'dev',
  apiUrl: 'https://api.dev.cv.ikiwii.com',
  authUrl: 'https://auth.dev.cv.ikiwii.com',
  userPoolId: 'us-east-1_AbCdEf123',
  webClientId: '1example23456789abcdefghij',
};
