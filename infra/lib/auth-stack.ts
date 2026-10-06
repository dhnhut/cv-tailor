import { Duration, RemovalPolicy, SecretValue, Stack, type StackProps } from 'aws-cdk-lib';
import {
  AccountRecovery,
  type CfnUserPool,
  FeaturePlan,
  Mfa,
  OAuthScope,
  ProviderAttribute,
  ResourceServerScope,
  StringAttribute,
  UserPool,
  UserPoolClientIdentityProvider,
  UserPoolEmail,
  UserPoolIdentityProviderGoogle,
  UserPoolOperation,
} from 'aws-cdk-lib/aws-cognito';
import { Policy, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Architecture, Code, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';

// Other stacks read these at deploy time, so no CloudFormation export ties them to this stack:
// the sign-in domain (S2-05), the API authorizer (S2-09), and the web app's config.json (S2-10).
export const USER_POOL_ID_PARAMETER = '/cv-tailor/auth/user-pool-id';
export const WEB_CLIENT_ID_PARAMETER = '/cv-tailor/auth/web-client-id';

// Every API method will require this scope (ADR-0009 §6). ID tokens have no scopes, so the API
// accepts only access tokens.
export const API_RESOURCE_SERVER = 'cv-tailor-api';
export const API_USER_SCOPE = 'user';

// Members are added and removed by hand (users-and-admins runbook, ADR-0009 §7).
export const ADMIN_GROUP = 'admin';

// Where managed login sends the browser back, on each web origin. S2-10's routes must match.
export const SIGN_IN_CALLBACK_PATH = '/auth/callback';
export const SIGN_OUT_PATH = '/';

// The Google client's secret, stored by hand in each environment that has Google sign-in
// (google-sign-in runbook). CloudFormation reads it at deploy time, so it's never in the repo or a
// template. Not an SSM SecureString: CloudFormation resolves those only for a short list of
// resource types, and the Cognito identity provider isn't one of them.
export const GOOGLE_CLIENT_SECRET_NAME = 'cv-tailor/google-client-secret';

// The only Cognito actions the pre sign-up trigger uses (apps/api/.../pre-sign-up/cognito.ts).
export const PRE_SIGN_UP_ACTIONS = [
  'cognito-idp:ListUsers',
  'cognito-idp:AdminCreateUser',
  'cognito-idp:AdminSetUserPassword',
  'cognito-idp:AdminLinkProviderForUser',
  'cognito-idp:AdminDeleteUser',
];

export interface AuthStackProps extends StackProps {
  readonly userPoolName: string;
  readonly webOrigins: readonly string[]; // where the web app runs
  readonly googleClientId?: string; // absent: no Google sign-in in this environment
  readonly preSignUpDirectory: string; // the pre sign-up trigger's build output (S2-07)
}

// The user pool and the web app's client for one environment (S2-05, ADR-0009). Data is keyed by
// each user's sub, and a lost pool can't be restored (Cognito can't export passwords), so the
// pool has deletion protection, a retain policy, termination protection, and a fixed logical ID.
export class AuthStack extends Stack {
  constructor(scope: Construct, id: string, props: AuthStackProps) {
    const { userPoolName, webOrigins, googleClientId, preSignUpDirectory, ...stackProps } = props;
    super(scope, id, { terminationProtection: true, ...stackProps });

    const userPool = new UserPool(this, 'UserPool', {
      userPoolName,
      featurePlan: FeaturePlan.ESSENTIALS,
      // Permanent: Cognito can't change these three once the pool exists (ADR-0009 §4).
      signInAliases: { email: true }, // the email address is the username
      signInCaseSensitive: false, // CDK's default is true
      standardAttributes: { email: { required: true, mutable: true } }, // Google updates it (S2-06)
      // Google's hd claim: the Workspace domain of a Google account (S2-13, ADR-0009 §2). Permanent:
      // Cognito can't remove or change a custom attribute. Mutable, because Cognito rewrites mapped
      // attributes at sign-in, and an immutable one would make that sign-in fail.
      customAttributes: { hd: new StringAttribute({ mutable: true }) },
      selfSignUpEnabled: true, // the web app's sign-up form will call SignUp (ADR-0009 §8)
      autoVerify: { email: true }, // a sign-up confirms its email with an emailed code
      keepOriginal: { email: true }, // a new email address is used only once it's verified
      passwordPolicy: {
        minLength: 8,
        requireLowercase: false, // CDK requires every character type by default
        requireUppercase: false,
        requireDigits: false,
        requireSymbols: false,
      },
      mfa: Mfa.OFF,
      accountRecovery: AccountRecovery.EMAIL_ONLY, // CDK's default also allows SMS
      email: UserPoolEmail.withCognito(), // 50 emails a day; SES before the first prod release
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    // CloudFormation tracks a resource by its logical ID. If a refactor changed it, CloudFormation
    // would create a new, empty pool and only retain the old one.
    (userPool.node.defaultChild as CfnUserPool).overrideLogicalId('UserPool');

    // The pre sign-up trigger links a first Google sign-in to the person's local user, so their
    // sub never changes (S2-07, ADR-0009 §1–§2). Cognito waits 5 seconds for it.
    const preSignUp = new LambdaFunction(this, 'PreSignUp', {
      description: 'Links Google sign-ins to local users (S2-07, ADR-0009 section 2)',
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      handler: 'index.handler',
      code: Code.fromAsset(preSignUpDirectory), // built by apps/api before AWS credentials exist
      timeout: Duration.seconds(5), // Cognito stops waiting at 5 seconds anyway
      memorySize: 512, // more memory gives more CPU, so a shorter cold start; the cost is negligible
      logGroup: new LogGroup(this, 'PreSignUpLogs', { retention: RetentionDays.ONE_MONTH }),
      // No reserved concurrency: AdminCreateUser (case 4) invokes this function again while it runs.
    });
    userPool.addTrigger(UserPoolOperation.PRE_SIGN_UP, preSignUp); // adds the invoke permission too

    // A separate policy, not preSignUp.addToRolePolicy: the pool depends on the function (its
    // trigger), and the function depends on its role's default policy, so the pool's ARN there
    // would make a dependency cycle.
    new Policy(this, 'PreSignUpCognitoAccess', {
      roles: [preSignUp.role!],
      statements: [
        new PolicyStatement({ actions: PRE_SIGN_UP_ACTIONS, resources: [userPool.userPoolArn] }),
      ],
    });

    // Google sign-in (S2-06). Asks Google only for the email address (SAFE-04), and maps whether
    // Google verified it: mapped emails are unverified otherwise, and the pre sign-up trigger
    // links accounts only on a verified address (S2-07). It also maps hd, so the trigger can tell
    // a Google Workspace account (S2-13).
    const google = googleClientId
      ? new UserPoolIdentityProviderGoogle(this, 'Google', {
          userPool,
          clientId: googleClientId,
          clientSecretValue: SecretValue.secretsManager(GOOGLE_CLIENT_SECRET_NAME),
          scopes: ['openid', 'email'], // CDK's default is profile: name and photo, not needed
          attributeMapping: {
            email: ProviderAttribute.GOOGLE_EMAIL,
            emailVerified: ProviderAttribute.GOOGLE_EMAIL_VERIFIED,
            // CDK passes these keys through as they are, so the key needs the custom: prefix.
            custom: { 'custom:hd': ProviderAttribute.other('hd') },
          },
        })
      : undefined;

    const userScope = new ResourceServerScope({
      scopeName: API_USER_SCOPE,
      scopeDescription: 'Call the CV Tailor API as the signed-in user',
    });
    const api = userPool.addResourceServer('ApiResourceServer', {
      identifier: API_RESOURCE_SERVER,
      userPoolResourceServerName: 'CV Tailor API',
      scopes: [userScope],
    });

    // A public client: a browser can't keep a secret. Cognito can't require PKCE, so the web
    // app's sign-in library adds it (S2-10).
    const client = userPool.addClient('WebClient', {
      userPoolClientName: 'cv-tailor-web',
      generateSecret: false,
      // Managed login offers the flows allowed here, and SRP gives it password sign-in. Refresh
      // goes through the token endpoint, because rotation rules out ALLOW_REFRESH_TOKEN_AUTH.
      authFlows: { userSrp: true },
      oAuth: {
        flows: { authorizationCodeGrant: true }, // CDK's default also allows the implicit flow
        // CDK's default adds aws.cognito.signin.user.admin, which lets tokens change attributes.
        scopes: [OAuthScope.OPENID, OAuthScope.EMAIL, OAuthScope.resourceServer(api, userScope)],
        callbackUrls: webOrigins.map((origin) => `${origin}${SIGN_IN_CALLBACK_PATH}`),
        logoutUrls: webOrigins.map((origin) => `${origin}${SIGN_OUT_PATH}`),
      },
      supportedIdentityProviders: [
        UserPoolClientIdentityProvider.COGNITO,
        ...(google ? [UserPoolClientIdentityProvider.GOOGLE] : []),
      ],
      preventUserExistenceErrors: true,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(1), // CDK's default is 30 days
      refreshTokenRotationGracePeriod: Duration.seconds(10), // setting it turns rotation on
      enableTokenRevocation: true,
    });
    // The client names Google by a plain string, so CloudFormation can't see that the provider
    // must exist first. Without this, the deploy that adds both can fail.
    if (google) client.node.addDependency(google);

    userPool.addGroup('AdminGroup', {
      groupName: ADMIN_GROUP,
      description: 'Admins get the admin quota (QUOTA-03). Changed by hand only.',
    });

    new StringParameter(this, 'UserPoolIdParameter', {
      parameterName: USER_POOL_ID_PARAMETER,
      description: `ID of the ${userPoolName} user pool (S2-05)`,
      stringValue: userPool.userPoolId,
    });
    new StringParameter(this, 'WebClientIdParameter', {
      parameterName: WEB_CLIENT_ID_PARAMETER,
      description: `ID of the web app's client in ${userPoolName} (S2-05)`,
      stringValue: client.userPoolClientId,
    });
  }
}
