import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import {
  OidcProviderNative,
  PolicyDocument,
  PolicyStatement,
  Role,
  WebIdentityPrincipal,
} from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';
import type { EnvironmentName, GithubRepository } from '../config/environments.ts';

const GITHUB_OIDC_HOST = 'token.actions.githubusercontent.com';
const STS_AUDIENCE = 'sts.amazonaws.com';

// Roles that `cdk bootstrap` creates for the CLI. Bootstrap tags each one with
// aws-cdk:bootstrap-role. The CloudFormation execution role has no such tag.
const CDK_BOOTSTRAP_ROLES = ['deploy', 'file-publishing', 'image-publishing', 'lookup'];

export interface OidcStackProps extends StackProps {
  readonly repository: GithubRepository;
  readonly environment: EnvironmentName; // GitHub Environment the job must run in
}

// GitHub OIDC provider and deploy role for one account (S1-07, ADR-0004 §4).
// Deployed once per account from a laptop, because CI can't deploy before the role exists.
export class OidcStack extends Stack {
  constructor(scope: Construct, id: string, props: OidcStackProps) {
    const { repository, environment, ...stackProps } = props;
    super(scope, id, { terminationProtection: true, ...stackProps });

    const provider = new OidcProviderNative(this, 'GithubProvider', {
      url: `https://${GITHUB_OIDC_HOST}`,
      clientIds: [STS_AUDIENCE],
    });

    // Immutable subject format: repo:<owner>@<owner id>/<name>@<repository id>:environment:<env>
    const { owner, ownerId, name, id: repositoryId } = repository;
    const subject = `repo:${owner}@${ownerId}/${name}@${repositoryId}:environment:${environment}`;

    const role = new Role(this, 'DeployRole', {
      roleName: 'GithubDeployRole',
      assumedBy: new WebIdentityPrincipal(provider.oidcProviderArn, {
        StringEquals: {
          [`${GITHUB_OIDC_HOST}:aud`]: STS_AUDIENCE,
          [`${GITHUB_OIDC_HOST}:sub`]: subject,
        },
      }),
      // No direct permissions: the role can only hand work to the CDK bootstrap roles.
      inlinePolicies: {
        AssumeCdkBootstrapRoles: new PolicyDocument({
          statements: [
            new PolicyStatement({
              actions: ['sts:AssumeRole'],
              resources: [
                this.formatArn({
                  service: 'iam',
                  region: '',
                  resource: 'role',
                  resourceName: 'cdk-*',
                }),
              ],
              conditions: {
                StringEquals: { 'iam:ResourceTag/aws-cdk:bootstrap-role': CDK_BOOTSTRAP_ROLES },
              },
            }),
          ],
        }),
      },
    });

    new CfnOutput(this, 'DeployRoleArn', { value: role.roleArn });
  }
}
