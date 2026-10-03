import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, test } from 'vitest';
import { AuthStack } from '../lib/auth-stack.ts';
import { testApp } from './test-app.ts';

// User pool and web app client (S2-05, ADR-0009 §3–§7, verification steps 1–2). Expected values
// are written out literally, so changing a constant in the code also fails here.

describe('Auth stack', () => {
  const stack = new AuthStack(testApp(), 'Auth', {
    userPoolName: 'cv-tailor-dev-users',
    webOrigins: ['https://dev.cv.ikiwii.com', 'http://localhost:5173'],
  });
  const template = Template.fromStack(stack);
  const [clientId] = Object.keys(template.findResources('AWS::Cognito::UserPoolClient'));

  test('has termination protection', () => {
    expect(stack.terminationProtection).toBe(true);
  });

  // A new logical ID or a replacement would leave every user behind in the old pool.
  test('keeps one user pool, with a fixed logical ID, through deletion and replacement', () => {
    expect(Object.keys(template.findResources('AWS::Cognito::UserPool'))).toEqual(['UserPool']);
    template.hasResource('AWS::Cognito::UserPool', {
      Properties: Match.objectLike({ DeletionProtection: 'ACTIVE' }),
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
  });

  // Cognito can't change these once the pool exists. A new pool means a new sub for every user.
  test('signs users in with their email address, case-insensitively, on the Essentials plan', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      UserPoolName: 'cv-tailor-dev-users',
      UserPoolTier: 'ESSENTIALS',
      UsernameAttributes: ['email'],
      UsernameConfiguration: { CaseSensitive: false },
      Schema: [{ Name: 'email', Required: true, Mutable: true }],
    });
  });

  test('confirms a sign-up with an emailed code, and uses a new email only once verified', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: false },
      AutoVerifiedAttributes: ['email'],
      VerificationMessageTemplate: { DefaultEmailOption: 'CONFIRM_WITH_CODE' },
      UserAttributeUpdateSettings: { AttributesRequireVerificationBeforeUpdate: ['email'] },
      AccountRecoverySetting: { RecoveryMechanisms: [{ Name: 'verified_email', Priority: 1 }] },
      EmailConfiguration: { EmailSendingAccount: 'COGNITO_DEFAULT' },
    });
  });

  test('asks for 8 characters with no character-type rules, and has no MFA or SMS', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      MfaConfiguration: 'OFF',
      Policies: {
        PasswordPolicy: {
          MinimumLength: 8,
          RequireLowercase: false,
          RequireUppercase: false,
          RequireNumbers: false,
          RequireSymbols: false,
        },
      },
    });
    template.resourceCountIs('AWS::IAM::Role', 0); // CDK creates an SMS role only when SMS is used
  });

  test('gives the web app a public client: code flow only, no secret, no attribute-changing scope', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'cv-tailor-web',
      GenerateSecret: false,
      AllowedOAuthFlowsUserPoolClient: true,
      AllowedOAuthFlows: ['code'],
      AllowedOAuthScopes: [
        'openid',
        'email',
        { 'Fn::Join': ['', [{ Ref: Match.stringLikeRegexp('ApiResourceServer') }, '/user']] },
      ],
      ExplicitAuthFlows: ['ALLOW_USER_SRP_AUTH'],
      SupportedIdentityProviders: ['COGNITO'],
      PreventUserExistenceErrors: 'ENABLED',
    });
  });

  test('sends the browser back only to the web origins it is given', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      CallbackURLs: [
        'https://dev.cv.ikiwii.com/auth/callback',
        'http://localhost:5173/auth/callback',
      ],
      LogoutURLs: ['https://dev.cv.ikiwii.com/', 'http://localhost:5173/'],
    });
  });

  test('issues one-hour tokens and a one-day refresh token that rotates on every use', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      AccessTokenValidity: 60,
      IdTokenValidity: 60,
      RefreshTokenValidity: 1440,
      TokenValidityUnits: { AccessToken: 'minutes', IdToken: 'minutes', RefreshToken: 'minutes' },
      RefreshTokenRotation: { Feature: 'ENABLED', RetryGracePeriodSeconds: 10 },
      EnableTokenRevocation: true,
    });
  });

  test('defines the API scope that every API method will require', () => {
    template.hasResourceProperties(
      'AWS::Cognito::UserPoolResourceServer',
      Match.objectEquals({
        UserPoolId: { Ref: 'UserPool' },
        Identifier: 'cv-tailor-api',
        Name: 'CV Tailor API',
        Scopes: [
          { ScopeName: 'user', ScopeDescription: 'Call the CV Tailor API as the signed-in user' },
        ],
      }),
    );
  });

  test('has an admin group that maps to no IAM role', () => {
    template.hasResourceProperties(
      'AWS::Cognito::UserPoolGroup',
      Match.objectEquals({
        UserPoolId: { Ref: 'UserPool' },
        GroupName: 'admin',
        Description: 'Admins get the admin quota (QUOTA-03). Changed by hand only.',
      }),
    );
  });

  test('publishes the pool and client IDs in SSM, where other stacks read them', () => {
    template.resourceCountIs('AWS::SSM::Parameter', 2);
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/cv-tailor/auth/user-pool-id',
      Type: 'String',
      Value: { Ref: 'UserPool' },
    });
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/cv-tailor/auth/web-client-id',
      Type: 'String',
      Value: { Ref: clientId },
    });
  });

  test('has no Google sign-in unless it gets a Google client ID', () => {
    template.resourceCountIs('AWS::Cognito::UserPoolIdentityProvider', 0);
  });
});

// Google sign-in (S2-06). The secret appears only as a Secrets Manager reference, which
// CloudFormation resolves at deploy time.
describe('Auth stack with Google sign-in', () => {
  const template = Template.fromStack(
    new AuthStack(testApp(), 'Auth', {
      userPoolName: 'cv-tailor-dev-users',
      webOrigins: ['https://dev.cv.ikiwii.com'],
      googleClientId: '123-abc.apps.googleusercontent.com',
    }),
  );
  const [googleId] = Object.keys(template.findResources('AWS::Cognito::UserPoolIdentityProvider'));

  test('asks Google only for the email address, and maps whether Google verified it', () => {
    template.resourceCountIs('AWS::Cognito::UserPoolIdentityProvider', 1);
    template.hasResourceProperties(
      'AWS::Cognito::UserPoolIdentityProvider',
      Match.objectEquals({
        UserPoolId: { Ref: 'UserPool' },
        ProviderName: 'Google',
        ProviderType: 'Google',
        ProviderDetails: {
          client_id: '123-abc.apps.googleusercontent.com',
          client_secret:
            '{{resolve:secretsmanager:cv-tailor/google-client-secret:SecretString:::}}',
          authorize_scopes: 'openid email',
        },
        AttributeMapping: { email: 'email', email_verified: 'email_verified' },
      }),
    );
  });

  test('offers Google on the web client, after the provider exists', () => {
    template.hasResource('AWS::Cognito::UserPoolClient', {
      Properties: Match.objectLike({ SupportedIdentityProviders: ['COGNITO', 'Google'] }),
      DependsOn: Match.arrayWith([googleId]),
    });
  });
});
