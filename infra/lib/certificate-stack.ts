import { Stack, type StackProps } from 'aws-cdk-lib';
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager';
import { HostedZone } from 'aws-cdk-lib/aws-route53';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import { ZONE_ID_PARAMETER } from './zone-stack.ts';

// The workload stage reads the certificate ARN from here at deploy time (S2-04 onwards).
export const CERTIFICATE_ARN_PARAMETER = '/cv-tailor/dns/certificate-arn';

export interface CertificateStackProps extends StackProps {
  readonly zoneName: string;
}

// The ACM certificate for <host> and *.<host> (S2-03, ADR-0008). CloudFront, API Gateway,
// and the Cognito custom domain all use it, which is why it lives in us-east-1.
// It's a stack of its own: ACM checks the validation record through public DNS, so this
// stack is deployed only after the zone's delegation resolves (deploy runbook, step 3).
export class CertificateStack extends Stack {
  constructor(scope: Construct, id: string, props: CertificateStackProps) {
    const { zoneName, ...stackProps } = props;
    super(scope, id, { terminationProtection: true, ...stackProps });

    const zone = HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      zoneName,
      hostedZoneId: StringParameter.valueForStringParameter(this, ZONE_ID_PARAMETER),
    });

    const certificate = new Certificate(this, 'Certificate', {
      certificateName: zoneName,
      domainName: zoneName,
      subjectAlternativeNames: [`*.${zoneName}`],
      validation: CertificateValidation.fromDns(zone),
    });

    new StringParameter(this, 'CertificateArnParameter', {
      parameterName: CERTIFICATE_ARN_PARAMETER,
      description: `ACM certificate for ${zoneName} and *.${zoneName} (S2-03)`,
      stringValue: certificate.certificateArn,
    });
  }
}
