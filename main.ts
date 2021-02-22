import { Construct } from 'constructs';
import { App, TerraformStack, TerraformOutput,EtcdV3Backend, TerraformVariable } from 'cdktf';
import { IbmProvider, IsSubnet, IsVpc, IsVpcAddressPrefix, IsLb, IsLbPool, IsLbListener, DataIbmIsImage, DataIbmIsSshKey,IsInstanceTemplate, 
  IsInstanceGroup, IsInstanceGroupManager, IsInstanceGroupManagerPolicy, IsSecurityGroup, IsSecurityGroupRule, IsPublicGateway } from './.gen/providers/ibm'
import { readFileSync } from 'fs'

class MyStack extends TerraformStack {
  constructor(scope: Construct, name: string) {
    super(scope, name);

    //provider
    new IbmProvider(this, "ibm", {
      region: 'us-south',
      generation: 2
    });

    const base_name = new TerraformVariable(this,"base_name",{
      type: 'string'
    })

    const image = new DataIbmIsImage(this,"ubuntu-image", {
      name: "ibm-ubuntu-18-04-1-minimal-amd64-2"
    });

    const sshkey = new DataIbmIsSshKey(this, "ssh-key", {
      name: "tutorial"
    });

    //resources
    const vpc = new IsVpc(this, "dev_vpc", {
      name: base_name.stringValue + '-development-vpc',
      tags: ['managedby:terraform','env:dev']
    });


    const pgw1 = new IsPublicGateway(this,"public-gateway-1", {
      name: base_name.stringValue + "-public-gateway-1",
      vpc: vpc.id,
      zone: "us-south-1",
    })

    const pgw2 = new IsPublicGateway(this,"public-gateway-2",{
      name: base_name.stringValue + "-public-gateway-2",
      vpc: vpc.id,
      zone: "us-south-2"
    })

    const ap1= new IsVpcAddressPrefix(this, "dev_vpc_address_prefix_1", {
      name: base_name.stringValue + '-prefix-1',
      zone: 'us-south-1',
      vpc: vpc.id,
      cidr: '10.10.0.0/16'
    });

    const ap2 = new IsVpcAddressPrefix(this, "dev_vpc_address_prefix_2", {
      name: base_name.stringValue + '-prefix-2',
      zone: 'us-south-2',
      vpc: vpc.id,
      cidr: '10.20.0.0/16'
    });

    const private1 = new IsSubnet(this,"privatesubnet1", {
        name: base_name.stringValue + '-private-subnet-1',
        vpc: vpc.id,
        zone: 'us-south-1',
        ipv4CidrBlock: '10.10.1.0/24',
        publicGateway: pgw1.id,
        dependsOn: [ap1]
        
    })
    
    const private2 = new IsSubnet(this,"privatesubnet2", {
      name: base_name.stringValue + '-private-subnet-2',
      vpc: vpc.id,
      zone: 'us-south-2',
      ipv4CidrBlock: '10.20.2.0/24',
      publicGateway: pgw2.id,
      dependsOn: [ap2]
    });

    const sg = new IsSecurityGroup(this,"tutorial_sg",{
      name: base_name.stringValue + "-sg",
      vpc: vpc.id,
    });

    new IsSecurityGroupRule(this, "inbound-http-rule",{
      group: sg.id,
      direction: "inbound",
      remote: "0.0.0.0/0",
      tcp: [{
        portMin: 80,
        portMax: 80
      }],
    })

    new IsSecurityGroupRule(this, "outbound-http-rule",{
      group: sg.id,
      direction: "outbound",
      remote: "0.0.0.0/0",
      tcp: [{
        portMin: 80,
        portMax: 80
      }],
    })

    new IsSecurityGroupRule(this, "outbound-https-rule",{
      group: sg.id,
      direction: "outbound",
      remote: "0.0.0.0/0",
      tcp: [{
        portMin: 443,
        portMax: 443
      }],
    })

    new IsSecurityGroupRule(this, "outbound-dns-rule",{
      group: sg.id,
      direction: "outbound",
      remote: "0.0.0.0/0",
      tcp: [{
        portMin: 53,
        portMax: 53
      }],
    })

    //LOAD BALANCER

    const lb = new IsLb(this,"load-balancer",{
      name: base_name.stringValue + "-alb",
      subnets: [private1.id,private2.id]
    })

    const lb_pool = new IsLbPool(this,"load-balancer-pool",{
      name: base_name.stringValue + "-alb-pool",
      lb: lb.id,
      protocol: "http",
      algorithm: "round_robin",
      healthDelay: 15,
      healthRetries: 2,
      healthTimeout: 5,
      healthType: "http",
      healthMonitorUrl: "/"
    }) 

    new IsLbListener(this, "load-balancer-listener", {
      lb: lb.id,
      protocol: "http",
      port: 80,
      defaultPool: lb_pool.poolId
    })

    const instance_template = new IsInstanceTemplate(this, "instance_template", {
      name: base_name.stringValue + "-instance-template-ubuntu",
      image: image.id,
      keys: [sshkey.id],
      profile: "cx2-2x4",
      primaryNetworkInterface: [{
        subnet: private1.id,
        securityGroups: [sg.id]
      }],
      vpc: vpc.id,
      zone: 'us-south-1',
      userData: readFileSync('scripts/userdata.sh').toString('utf-8'),
    });

    const instance_group = new IsInstanceGroup(this, "instance_group",{
      name: base_name.stringValue + "-instance-group",
      instanceTemplate: instance_template.id,
      instanceCount: 2,
      subnets: [private1.id,private2.id],
      loadBalancer: lb.id,
      loadBalancerPool: lb_pool.poolId,
      applicationPort: 80
    })

    const group_manager = new IsInstanceGroupManager(this, "instance_group_manager", {
      name: base_name.stringValue + "-instance-group-manager",
      aggregationWindow: 90,
      cooldown: 120, 
      enableManager: true,
      instanceGroup: instance_group.id,
      minMembershipCount: 2,
      maxMembershipCount: 5,
    })

    new IsInstanceGroupManagerPolicy(this, "cpu-policy", {
      name: base_name.stringValue + "-cpu-policy",
      instanceGroup: instance_group.id,
      instanceGroupManager: group_manager.managerId,
      metricType: "cpu",
      metricValue: 80,
      policyType: "target",
    })
  
    new TerraformOutput(this, 'lb-host', {
      value: lb.hostname
    })
  }
}

const app = new App();
const stack = new MyStack(app, 'TerraformCDK');

new EtcdV3Backend(stack, {
  endpoints: process.env.ETCD_HOST!.split(','),
  password: process.env.ETCD_PASSWORD,
  username: process.env.ETCD_USERNAME,
  prefix: "terraform-state/",
  lock: true,
  cacertPath:'../ca.crt',
  certPath: '../certificate.pem',
  keyPath: '../key.pem'
})

app.synth();
