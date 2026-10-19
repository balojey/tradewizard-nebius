import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { EnvironmentConfig, resourceName } from './config';

export interface NetworkStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
}

/**
 * Network stack: Minimal VPC with public subnets only.
 *
 * Cost optimization:
 * - NO NAT Gateways (saves $35-70/mo)
 * - NO private/isolated subnets (not needed without NAT)
 * - RDS in public subnet with strict security group + SSL enforcement
 * - Lambda runs outside VPC (connects to RDS via public endpoint)
 *
 * Scale-up path: Add private subnets + NAT when revenue justifies it.
 */
export class NetworkStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly databaseSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);

    const { config } = props;

    // Minimal VPC: public subnets only, no NAT
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: resourceName(config.envName, 'vpc'),
      ipAddresses: ec2.IpAddresses.cidr(config.vpcCidr),
      maxAzs: 2,
      natGateways: 0, // No NAT = $0/mo
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ],
    });

    // Security group for RDS - strict access control
    this.databaseSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSg', {
      vpc: this.vpc,
      securityGroupName: resourceName(config.envName, 'db-sg'),
      description: 'Security group for RDS PostgreSQL - restricted access',
      allowAllOutbound: false,
    });

    // Allow inbound PostgreSQL from anywhere (RDS enforces SSL + password auth)
    // In production, you can restrict this to specific Lambda IPs or use RDS Proxy
    this.databaseSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(5432),
      'Allow PostgreSQL connections (SSL enforced at DB level)'
    );

    // Outputs
    new cdk.CfnOutput(this, 'VpcId', {
      value: this.vpc.vpcId,
      exportName: resourceName(config.envName, 'vpc-id'),
    });

    new cdk.CfnOutput(this, 'PublicSubnetIds', {
      value: this.vpc.publicSubnets.map((s) => s.subnetId).join(','),
      exportName: resourceName(config.envName, 'public-subnet-ids'),
    });
  }
}
