import { composeTemplate } from './compose.mjs';

export function routingFixture() {
  const timestamp = '2026-09-14T09:00:00.000Z';
  const template = composeTemplate();
  const project = template.name;
  const networkIds = { database: '1'.repeat(64), mail: '2'.repeat(64) };
  const containers = ['auth', 'rest'].map((name, index) => {
    const endpoints = {};
    for (const network of template.services[name].networks) {
      endpoints[`${project}_${network}`] = {
        NetworkID: networkIds[network],
        EndpointID: String(index + (network === 'mail' ? 7 : 5)).repeat(64),
        IPAddress: network === 'mail' ? '172.22.0.4' : `172.23.0.${4 - index}`,
        IPPrefixLen: 16,
      };
    }
    return {
      Id: String(index + 3).repeat(64),
      Name: `/${project}-${name}-1`,
      Config: {
        Image: template.services[name].image,
        Labels: {
          'com.docker.compose.project': project,
          'com.docker.compose.service': name,
        },
      },
      State: { Running: true, Health: { Status: 'healthy' } },
      HostConfig: {
        NetworkMode: `${project}_database`,
        RestartPolicy: { Name: 'no' },
        Privileged: false,
      },
      NetworkSettings: { Networks: endpoints },
    };
  });
  const networks = ['database', 'mail'].map((name) => {
    const members = {};
    for (const container of containers) {
      const endpoint = container.NetworkSettings.Networks[`${project}_${name}`];
      if (endpoint)
        members[container.Id] = {
          Name: container.Name.slice(1),
          EndpointID: endpoint.EndpointID,
          IPv4Address: `${endpoint.IPAddress}/16`,
        };
    }
    return {
      Id: networkIds[name],
      Name: `${project}_${name}`,
      Driver: 'bridge',
      Internal: true,
      EnableIPv6: false,
      Labels: {
        'com.docker.compose.project': project,
        'com.docker.compose.network': name,
      },
      Options: template.networks[name].driver_opts,
      IPAM: {
        Config: [
          {
            Subnet: name === 'database' ? '172.23.0.0/16' : '172.22.0.0/16',
            Gateway: name === 'database' ? '172.23.0.1' : '172.22.0.1',
          },
        ],
      },
      Containers: members,
    };
  });
  const identities = {};
  for (const [index, name] of ['auth', 'rest'].entries()) {
    const endpoint =
      containers[index].NetworkSettings.Networks[`${project}_database`];
    identities[name] = {
      id: containers[index].Id,
      ip: endpoint.IPAddress,
      endpointId: endpoint.EndpointID,
    };
  }
  return {
    now: Date.parse(timestamp),
    receipt: {
      version: 1,
      host: 'staging-auth.ogabassey.com',
      verifiedAt: timestamp,
      firewallVerified: true,
      hostReachabilityVerified: true,
      containers: identities,
      networks: {
        database: { id: networkIds.database, subnet: '172.23.0.0/16' },
        mail: { id: networkIds.mail, subnet: '172.22.0.0/16' },
      },
      restRoutes: [
        { path: '/rest/v1/synthetic_goals', methods: ['GET', 'HEAD'] },
      ],
    },
    inventory: { observedAt: timestamp, containers, networks },
  };
}
