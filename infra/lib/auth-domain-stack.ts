import { Stack, type StackProps } from 'aws-cdk-lib';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import {
  CfnManagedLoginBranding,
  ManagedLoginVersion,
  UserPool,
  UserPoolDomain,
} from 'aws-cdk-lib/aws-cognito';
import { ARecord, HostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { UserPoolDomainTarget } from 'aws-cdk-lib/aws-route53-targets';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import { USER_POOL_ID_PARAMETER, WEB_CLIENT_ID_PARAMETER } from './auth-stack.ts';
import { CERTIFICATE_ARN_PARAMETER } from './certificate-stack.ts';
import { ZONE_ID_PARAMETER } from './zone-stack.ts';

export interface AuthDomainStackProps extends StackProps {
  readonly host: string; // the web app's host; the sign-in pages are at auth.<host>
}

// The sign-in pages at https://auth.<host>: managed login on a custom domain (S2-05, ADR-0008,
// ADR-0009). A stack of its own, deployed after AuthStack and WebStack: it reads AuthStack's IDs,
// and Cognito creates the domain only when <host>, which WebStack serves, resolves. It holds no
// data, so it can be deleted and created again.
export class AuthDomainStack extends Stack {
  constructor(scope: Construct, id: string, props: AuthDomainStackProps) {
    const { host, ...stackProps } = props;
    super(scope, id, stackProps);

    const domainName = `auth.${host}`;
    const userPoolId = StringParameter.valueForStringParameter(this, USER_POOL_ID_PARAMETER);

    // CDK's default version is the classic hosted UI.
    const domain = new UserPoolDomain(this, 'Domain', {
      userPool: UserPool.fromUserPoolId(this, 'UserPool', userPoolId),
      customDomain: {
        domainName,
        // *.<host> covers auth.<host>. Cognito serves the domain through CloudFront, so the
        // certificate must be in us-east-1, which it is (ADR-0008).
        certificate: Certificate.fromCertificateArn(
          this,
          'Certificate',
          StringParameter.valueForStringParameter(this, CERTIFICATE_ARN_PARAMETER),
        ),
      },
      managedLoginVersion: ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });

    // A client created through the API, as CloudFormation creates it, has no managed login pages
    // until it has a style. Cognito's default look is enough for now.
    const style = new CfnManagedLoginBranding(this, 'Style', {
      userPoolId,
      clientId: StringParameter.valueForStringParameter(this, WEB_CLIENT_ID_PARAMETER),
      useCognitoProvidedValues: true,
    });
    style.node.addDependency(domain); // styles apply to a domain that serves managed login

    const zone = HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      zoneName: host,
      hostedZoneId: StringParameter.valueForStringParameter(this, ZONE_ID_PARAMETER),
    });
    // AWS documents an A alias for this record. No AAAA until IPv6 is confirmed.
    new ARecord(this, 'Alias', {
      zone,
      recordName: domainName,
      target: RecordTarget.fromAlias(new UserPoolDomainTarget(domain)),
    });
  }
}
