import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual, promisify } from 'node:util';
import { probeGateway } from './gateway_probe.mjs';

const endpoints = {
  auth: '180d11b7c11601217b5202d524be1762b04531d64c66ca589c04fc822c4ffe24',
  rest: 'f6a66017e2d3e8b4ea8f288b2bc91dfccfe9757d551bce80a0d692df2fe42fa7',
};

export async function refreshEndpoints(input, ports) {
  if (!input || Object.keys(input).join(',') !== 'binding')
    throw new Error('Endpoint input refused');
  let runtime = ports;
  if (!runtime) {
    const root = 'file:///opt/baci-savings-gateway/';
    const execute = promisify(execFile);
    runtime = {
      ...(await import(`${root}managed-gateway.mjs`)),
      ...(await import(`${root}private-routing-inventory.mjs`)),
      ...(await import(`${root}private-routing-supervisor-inventory.mjs`)),
      run: (command, args) =>
        execute(command, args, {
          env: {
            PATH: '/usr/sbin:/usr/bin:/sbin:/bin',
            LANG: 'C',
            LC_ALL: 'C',
          },
          timeout: 5000,
          killSignal: 'SIGKILL',
          maxBuffer: 262144,
        }),
    };
  }
  runtime.validateManagedBinding(input.binding, Date.now());
  const inventory = await runtime.collectSupervisorInventory(
    input.binding.identity,
    async (args) => (await runtime.run('/usr/bin/docker', args)).stdout,
    Date.now
  );
  const binding = structuredClone(input.binding);
  for (const name of ['auth', 'rest']) {
    const expected = binding.identity.containers[name];
    const matches = inventory.containers.filter(
      (row) => row.Id === expected.id
    );
    const networks = inventory.networks.filter(
      (row) => row.Id === binding.identity.networks.database.id
    );
    if (matches.length !== 1 || networks.length !== 1)
      throw new Error('Endpoint identity refused');
    const network = networks[0];
    const endpoint = matches[0].NetworkSettings.Networks[network.Name];
    if (!endpoint || endpoint.EndpointID !== endpoints[name])
      throw new Error('Endpoint pin refused');
    expected.endpointId = endpoint.EndpointID;
  }
  runtime.validateRoutingIdentity(binding.identity, inventory);
  const unchanged = structuredClone(binding);
  for (const name of ['auth', 'rest'])
    unchanged.identity.containers[name].endpointId =
      input.binding.identity.containers[name].endpointId;
  if (!isDeepStrictEqual(unchanged, input.binding))
    throw new Error('Endpoint scope refused');
  const { evidence } = await probeGateway('collect', { binding }, runtime);
  runtime.validateManagedStartup(binding, evidence, Date.now());
  runtime.generateManagedGateway(binding, evidence.inventory, Date.now());
  return { binding, evidence };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    if (
      process.platform !== 'linux' ||
      process.geteuid() !== 0 ||
      process.argv.length !== 2
    )
      throw new Error('Root endpoint probe required');
    const chunks = [];
    let length = 0;
    for await (const chunk of process.stdin) {
      length += chunk.length;
      if (length > 262144) throw new Error('Input refused');
      chunks.push(chunk);
    }
    process.stdout.write(
      JSON.stringify(await refreshEndpoints(JSON.parse(Buffer.concat(chunks))))
    );
  } catch {
    process.stderr.write('Endpoint refresh probe refused.\n');
    process.exitCode = 1;
  }
}
