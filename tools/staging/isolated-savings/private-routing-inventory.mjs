import { isIP } from 'node:net';
import { composeTemplate } from './compose.mjs';

const project = 'baci-isolated-savings';
const host = 'staging-auth.ogabassey.com';
const idPattern = /^[a-f0-9]{64}$/;

function requireValue(condition) {
  if (!condition) throw new Error('Private routing evidence rejected');
}

function exact(value, keys) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value));
  requireValue(
    Object.keys(value).sort().join(',') === [...keys].sort().join(',')
  );
}

function recent(value, now) {
  requireValue(typeof value === 'string');
  const timestamp = Date.parse(value);
  requireValue(
    Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= 300000
  );
  return timestamp;
}

function address(value) {
  requireValue(typeof value === 'string' && isIP(value) === 4);
  const octets = value.split('.').map(Number);
  requireValue(
    octets[0] === 10 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168)
  );
  return octets.reduce((total, octet) => total * 256 + octet, 0);
}

function inSubnet(ip, subnet, gateway) {
  requireValue(typeof subnet === 'string');
  const pieces = subnet.split('/');
  requireValue(
    pieces.length === 2 && /^(?:[89]|[12][0-9]|30)$/.test(pieces[1])
  );
  const size = 2 ** (32 - Number(pieces[1]));
  const base = address(pieces[0]);
  const target = address(ip);
  const gatewayAddress = address(gateway);
  requireValue(gatewayAddress > base && gatewayAddress < base + size - 1);
  requireValue(base % size === 0 && target > base && target < base + size - 1);
  requireValue(ip !== gateway);
  return Number(pieces[1]);
}

export function validateRoutingIdentityShape(receipt) {
  exact(receipt, ['host', 'containers', 'networks', 'restRoutes']);
  requireValue(receipt.host === host);
  exact(receipt.containers, ['auth', 'rest']);
  exact(receipt.networks, ['database', 'mail']);
  for (const expected of Object.values(receipt.networks)) {
    exact(expected, ['id', 'subnet']);
    requireValue(
      typeof expected.id === 'string' && idPattern.test(expected.id)
    );
    requireValue(typeof expected.subnet === 'string');
    const [base, prefix, extra] = expected.subnet.split('/');
    requireValue(extra === undefined && /^(?:[89]|[12][0-9]|30)$/.test(prefix));
    requireValue(address(base) % 2 ** (32 - Number(prefix)) === 0);
  }
  for (const expected of Object.values(receipt.containers)) {
    exact(expected, ['id', 'ip', 'endpointId']);
    for (const value of [expected.id, expected.endpointId])
      requireValue(typeof value === 'string' && idPattern.test(value));
    const target = address(expected.ip);
    const [base, prefix] = receipt.networks.database.subnet.split('/');
    requireValue(
      target > address(base) &&
        target < address(base) + 2 ** (32 - Number(prefix)) - 1
    );
  }
  requireValue(receipt.networks.database.id !== receipt.networks.mail.id);
  requireValue(receipt.containers.auth.id !== receipt.containers.rest.id);
  requireValue(receipt.containers.auth.ip !== receipt.containers.rest.ip);
  validateRoutingRoutes(receipt.restRoutes);
}

export function validatePrivateRouting(receipt, inventory, now) {
  requireValue(Number.isSafeInteger(now) && now > 0);
  exact(receipt, [
    'version',
    'host',
    'verifiedAt',
    'firewallVerified',
    'hostReachabilityVerified',
    'containers',
    'networks',
    'restRoutes',
  ]);
  exact(inventory, ['observedAt', 'containers', 'networks']);
  requireValue(receipt.version === 1);
  requireValue(
    receipt.firewallVerified === true &&
      receipt.hostReachabilityVerified === true
  );
  const verified = recent(receipt.verifiedAt, now);
  const observed = recent(inventory.observedAt, now);
  requireValue(observed >= verified);
  const { host: identityHost, containers, networks, restRoutes } = receipt;
  return {
    ...validateRoutingIdentity(
      { host: identityHost, containers, networks, restRoutes },
      inventory
    ),
    expiresAt: new Date(verified + 300000).toISOString(),
  };
}

export function validateRoutingIdentity(receipt, inventory) {
  validateRoutingIdentityShape(receipt);
  exact(inventory, ['observedAt', 'containers', 'networks']);
  requireValue(
    Array.isArray(inventory.containers) && inventory.containers.length === 2
  );
  requireValue(
    Array.isArray(inventory.networks) && inventory.networks.length === 2
  );
  const template = composeTemplate();
  const networks = {};
  for (const name of ['database', 'mail']) {
    const expected = receipt.networks[name];
    exact(expected, ['id', 'subnet']);
    requireValue(idPattern.test(expected.id));
    const matches = inventory.networks.filter(
      (network) => network.Id === expected.id
    );
    requireValue(matches.length === 1);
    const network = matches[0];
    exact(network, [
      'Id',
      'Name',
      'Driver',
      'Internal',
      'EnableIPv6',
      'Labels',
      'Options',
      'IPAM',
      'Containers',
    ]);
    requireValue(
      network.Name === `${project}_${name}` && network.Driver === 'bridge'
    );
    requireValue(network.Internal === true && network.EnableIPv6 === false);
    requireValue(network.Labels?.['com.docker.compose.project'] === project);
    requireValue(network.Labels?.['com.docker.compose.network'] === name);
    requireValue(
      network.Options?.['com.docker.network.bridge.name'] ===
        template.networks[name].driver_opts['com.docker.network.bridge.name']
    );
    requireValue(
      network.IPAM?.Config?.length === 1 &&
        network.IPAM.Config[0].Subnet === expected.subnet
    );
    requireValue(network.Containers && typeof network.Containers === 'object');
    networks[name] = network;
  }
  requireValue(networks.database.Id !== networks.mail.Id);
  const destinations = {};
  for (const name of ['auth', 'rest']) {
    const expected = receipt.containers[name];
    exact(expected, ['id', 'ip', 'endpointId']);
    requireValue(
      idPattern.test(expected.id) && idPattern.test(expected.endpointId)
    );
    const matches = inventory.containers.filter(
      (container) => container.Id === expected.id
    );
    requireValue(matches.length === 1);
    const container = matches[0];
    exact(container, [
      'Id',
      'Name',
      'Config',
      'State',
      'HostConfig',
      'NetworkSettings',
    ]);
    exact(container.Config, ['Image', 'Labels']);
    exact(container.State, ['Running', 'Health']);
    exact(container.State.Health, ['Status']);
    exact(container.HostConfig, ['NetworkMode', 'RestartPolicy', 'Privileged']);
    exact(container.NetworkSettings, ['Networks']);
    requireValue(container.Name === `/${project}-${name}-1`);
    requireValue(container.Config.Image === template.services[name].image);
    requireValue(
      container.Config.Labels?.['com.docker.compose.project'] === project
    );
    requireValue(
      container.Config.Labels?.['com.docker.compose.service'] === name
    );
    requireValue(
      container.State.Running === true &&
        container.State.Health.Status === 'healthy'
    );
    requireValue(
      container.HostConfig.Privileged === false &&
        container.HostConfig.RestartPolicy?.Name === 'no'
    );
    requireValue(container.HostConfig.NetworkMode === `${project}_database`);
    const expectedNetworks =
      name === 'auth' ? ['database', 'mail'] : ['database'];
    exact(
      container.NetworkSettings.Networks,
      expectedNetworks.map((network) => `${project}_${network}`)
    );
    for (const networkName of expectedNetworks) {
      const network = networks[networkName];
      const endpoint = container.NetworkSettings.Networks[network.Name];
      exact(endpoint, ['NetworkID', 'EndpointID', 'IPAddress', 'IPPrefixLen']);
      requireValue(
        endpoint.NetworkID === network.Id && idPattern.test(endpoint.EndpointID)
      );
      const prefix = inSubnet(
        endpoint.IPAddress,
        network.IPAM.Config[0].Subnet,
        network.IPAM.Config[0].Gateway
      );
      requireValue(endpoint.IPPrefixLen === prefix);
      const member = network.Containers[container.Id];
      requireValue(
        member?.Name === container.Name.slice(1) &&
          member.EndpointID === endpoint.EndpointID
      );
      requireValue(member.IPv4Address === `${endpoint.IPAddress}/${prefix}`);
      requireValue(
        Object.values(network.Containers).filter(
          (entry) => entry.IPv4Address === member.IPv4Address
        ).length === 1
      );
      if (networkName === 'database') {
        requireValue(
          endpoint.IPAddress === expected.ip &&
            endpoint.EndpointID === expected.endpointId
        );
      }
    }
    destinations[name] = expected.ip;
  }
  requireValue(
    receipt.containers.auth.id !== receipt.containers.rest.id &&
      destinations.auth !== destinations.rest
  );
  return { host, destinations, restRoutes: receipt.restRoutes };
}

function validateRoutingRoutes(restRoutes) {
  requireValue(
    Array.isArray(restRoutes) &&
      restRoutes.length > 0 &&
      restRoutes.length <= 32
  );
  const routes = new Set();
  for (const route of restRoutes) {
    exact(route, ['path', 'methods']);
    requireValue(
      typeof route.path === 'string' &&
        /^\/rest\/v1\/(?:rpc\/)?[a-z][a-z0-9_]{0,62}$/.test(route.path)
    );
    requireValue(!routes.has(route.path));
    routes.add(route.path);
    requireValue(
      Array.isArray(route.methods) &&
        route.methods.length > 0 &&
        new Set(route.methods).size === route.methods.length
    );
    requireValue(
      route.methods.every((method) =>
        ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'].includes(method)
      )
    );
  }
}
