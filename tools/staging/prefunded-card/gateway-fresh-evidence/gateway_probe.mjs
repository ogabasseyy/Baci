import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const environment = {
  PATH: '/usr/sbin:/usr/bin:/sbin:/bin',
  LANG: 'C',
  LC_ALL: 'C',
};
const prefix = [
  '-q',
  '--silent',
  '--show-error',
  '--noproxy',
  '*',
  '--max-time',
  '3',
  '--output',
  '/dev/null',
  '--write-out',
  '%{http_code}',
];
const routes = [
  'https://staging-auth.ogabassey.com/auth/v1/user',
  ...['wallet', 'savings/goals', 'savings/drafts', 'savings/funding'].map(
    (suffix) =>
      `https://staging.ogabassey.com/api/storefront/customer/${suffix}`
  ),
];

async function installed() {
  const root = 'file:///opt/baci-savings-gateway/';
  const gateway = await import(`${root}managed-gateway.mjs`);
  const inventory = await import(
    `${root}private-routing-supervisor-inventory.mjs`
  );
  const execute = promisify(execFile);
  return {
    ...gateway,
    ...inventory,
    run: (executable, args) =>
      execute(executable, args, {
        env: environment,
        timeout: 5000,
        maxBuffer: 262144,
        killSignal: 'SIGKILL',
      }),
  };
}

export async function probeGateway(kind, input, ports) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Probe input refused');
  const keys = Object.keys(input).sort().join('|');
  if (
    (kind === 'collect' && keys !== 'binding') ||
    (kind === 'validate' && keys !== 'binding|evidence') ||
    (kind === 'verify' && keys !== '') ||
    !['collect', 'validate', 'verify'].includes(kind)
  )
    throw new Error('Probe scope refused');
  const runtime = ports ?? (await installed());
  if (kind === 'verify') {
    for (const [url, extra] of [
      [
        'http://staging-auth.ogabassey.com/auth/v1/user',
        ['--unix-socket', '/run/baci-savings-gateway/ingress.sock'],
      ],
      ...routes.map((url) => [url, []]),
    ]) {
      const result = await runtime.run('/usr/bin/curl', [
        ...prefix,
        ...extra,
        url,
      ]);
      if (result.stdout.trim() !== '401')
        throw new Error('Unauthenticated 401 refused');
    }
    return { status: 'unauthenticated-401-verified', probes: 6 };
  }
  const { binding } = input;
  runtime.validateManagedBinding(binding, Date.now());
  if (kind === 'validate') {
    runtime.validateManagedStartup(binding, input.evidence, Date.now());
    runtime.generateManagedGateway(
      binding,
      input.evidence.inventory,
      Date.now()
    );
    return { status: 'fresh-evidence-valid' };
  }
  for (const name of ['auth', 'rest']) {
    const suffix = name === 'auth' ? ':9999/health' : ':3000/';
    const url = `http://${binding.identity.containers[name].ip}${suffix}`;
    const result = await runtime.run('/usr/bin/curl', [...prefix, url]);
    if (result.stdout.trim() !== '200')
      throw new Error('Upstream health refused');
  }
  for (const bridge of ['baci-stg-db', 'baci-stg-mail'])
    await runtime.run('/usr/sbin/iptables', [
      '-w',
      '5',
      '-C',
      'INPUT',
      '-i',
      bridge,
      '-m',
      'conntrack',
      '--ctstate',
      'NEW',
      '-m',
      'comment',
      '--comment',
      'baci-isolated-savings',
      '-j',
      'DROP',
    ]);
  const verifiedAt = new Date().toISOString();
  const inventory = await runtime.collectSupervisorInventory(
    binding.identity,
    async (args) => (await runtime.run('/usr/bin/docker', args)).stdout,
    Date.now
  );
  const evidence = {
    receipt: {
      version: 1,
      ...binding.identity,
      verifiedAt,
      firewallVerified: true,
      hostReachabilityVerified: true,
    },
    inventory,
  };
  runtime.validateManagedStartup(binding, evidence, Date.now());
  runtime.generateManagedGateway(binding, inventory, Date.now());
  return { evidence };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    if (
      process.platform !== 'linux' ||
      process.geteuid() !== 0 ||
      process.argv.length !== 3
    )
      throw new Error('Root probe required');
    const chunks = [];
    let length = 0;
    for await (const chunk of process.stdin) {
      length += chunk.length;
      if (length > 262144) throw new Error('Probe input too large');
      chunks.push(chunk);
    }
    const result = await probeGateway(
      process.argv[2],
      JSON.parse(Buffer.concat(chunks).toString())
    );
    process.stdout.write(JSON.stringify(result));
  } catch {
    process.stderr.write('Fresh gateway proof refused.\n');
    process.exitCode = 1;
  }
}
