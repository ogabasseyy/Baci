import { officialStorageBootstrap } from './official-storage-bootstrap.mjs';

try {
  if (process.argv.length !== 3 || process.argv[2] !== '--template') throw new Error('Invalid mode');
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 16384) throw new Error('Oversized input');
  }
  process.stdout.write(`${JSON.stringify(officialStorageBootstrap(JSON.parse(input), Date.now()), null, 2)}\n`);
} catch {
  process.stderr.write('Official Storage bootstrap rejected; fresh reviewed isolated inventory required.\n');
  process.exitCode = 1;
}
