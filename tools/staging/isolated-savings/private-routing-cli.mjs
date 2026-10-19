import { generatePrivateRouting } from './private-routing.mjs';

try {
  if (process.argv.length !== 3 || process.argv[2] !== '--unprivileged-test') {
    throw new Error('Invalid arguments');
  }
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 262144) throw new Error('Oversized input');
  }
  const parsed = JSON.parse(input);
  if (!parsed || Object.keys(parsed).sort().join(',') !== 'inventory,receipt') {
    throw new Error('Invalid envelope');
  }
  const result = generatePrivateRouting(
    parsed.receipt,
    parsed.inventory,
    Date.now(),
    'unprivileged-test'
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch {
  process.stderr.write(
    'Private routing rejected; verify sanitized inventory and fresh ownership receipt.\n'
  );
  process.exitCode = 1;
}
