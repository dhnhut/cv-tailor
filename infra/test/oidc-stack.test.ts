import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, test } from 'vitest';
import { GITHUB_REPOSITORY, loadEnvironments } from '../config/environments.ts';
import { OidcStack } from '../lib/oidc-stack.ts';
import { testApp } from './test-app.ts';

// GitHub deploy role (S1-07, ADR-0004 §4). Expected values are written out literally,
// so changing a constant in the code also fails here.

const CONFIGS = loadEnvironments({
  CVT_DEV_ACCOUNT_ID: '111111111111',
  CVT_STAG_ACCOUNT_ID: '222222222222',
  CVT_PROD_ACCOUNT_ID: '333333333333',
});

describe.each(CONFIGS)('OIDC stack for $name', (config) => {
  const stack = new OidcStack(testApp(), 'GithubOidc', {
    env: { account: config.account, region: config.region },
    repository: GITHUB_REPOSITORY,
    environment: config.name,
  });
  const template = Template.fromStack(stack);
  const [providerId] = Object.keys(template.findResources('AWS::IAM::OIDCProvider'));

  test('creates one GitHub OIDC provider for the STS audience', () => {
    template.resourceCountIs('AWS::IAM::OIDCProvider', 1);
    template.hasResourceProperties(
      'AWS::IAM::OIDCProvider',
      Match.objectEquals({
        Url: 'https://token.actions.githubusercontent.com',
        ClientIdList: ['sts.amazonaws.com'],
      }),
    );
  });

  // objectEquals is exact at every level: an extra condition (such as a StringLike
  // wildcard) or an extra statement fails the test.
  test('trusts only this repository and GitHub Environment', () => {
    template.resourceCountIs('AWS::IAM::Role', 1);
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'GithubDeployRole',
      AssumeRolePolicyDocument: Match.objectEquals({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: 'sts:AssumeRoleWithWebIdentity',
            Principal: { Federated: { Ref: providerId } },
            Condition: {
              StringEquals: {
                'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
                'token.actions.githubusercontent.com:sub': `repo:dhnhut/cv-tailor:environment:${config.name}`,
              },
            },
          },
        ],
      }),
    });
  });

  test('can only assume the CDK bootstrap roles in its own account', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      ManagedPolicyArns: Match.absent(),
      Policies: Match.exact([
        {
          PolicyName: 'AssumeCdkBootstrapRoles',
          PolicyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: 'sts:AssumeRole',
                Resource: `arn:aws:iam::${config.account}:role/cdk-*`,
                Condition: {
                  StringEquals: {
                    'iam:ResourceTag/aws-cdk:bootstrap-role': [
                      'deploy',
                      'file-publishing',
                      'image-publishing',
                      'lookup',
                    ],
                  },
                },
              },
            ],
          },
        },
      ]),
    });
    template.resourceCountIs('AWS::IAM::Policy', 0);
    template.resourceCountIs('AWS::IAM::ManagedPolicy', 0);
  });

  test('has termination protection', () => {
    expect(stack.terminationProtection).toBe(true);
  });
});
