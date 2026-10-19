import {
  generateManagedGateway,
  validateManagedStartup,
} from '/opt/baci-savings-gateway/managed-gateway.mjs';

try {
  if (
    process.platform !== 'linux' ||
    process.geteuid() !== 0 ||
    process.argv.length !== 2
  )
    throw new Error();
  let content = '';
  for await (const chunk of process.stdin) {
    content += chunk;
    if (Buffer.byteLength(content) > 262144) throw new Error();
  }
  const value = JSON.parse(content);
  if (Object.keys(value).sort().join(',') !== 'binding,input')
    throw new Error();
  const now = Date.now();
  validateManagedStartup(value.binding, value.input, now);
  const checked = generateManagedGateway(
    value.binding,
    value.input.inventory,
    now
  );
  if (checked.expiresAt !== '2026-10-06T15:59:10.442Z') throw new Error();
  process.stdout.write(
    JSON.stringify({ valid: true, expiresAt: checked.expiresAt })
  );
} catch {
  process.stderr.write('Connectivity gateway evidence refused.\n');
  process.exitCode = 1;
}
