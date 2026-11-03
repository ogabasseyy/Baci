/** Loaded only by the credential-free, network-disabled gVisor Node profile. */
import { readBoundedUtf8 } from './bounded-input.mjs';

const input = await readBoundedUtf8(process.stdin);
console.error('PRERENDER_PHASE input');
const payload = JSON.parse(input);
if (typeof payload.javascript !== 'string' || !payload.bootstrap)
  throw Error('Invalid prerender job');
const module = await import(
  `data:text/javascript;base64,${Buffer.from(payload.javascript).toString('base64')}`
);
console.error('PRERENDER_PHASE imported');
const result = await module.prerender(payload.bootstrap);
console.error('PRERENDER_PHASE rendered');
if (
  result?.format !== 'baci-prerender/v1' ||
  typeof result.html !== 'string' ||
  Buffer.byteLength(result.html) > 2097152
)
  throw Error('Invalid prerender output');
// Browser-targeted React may retain scheduler handles. This is a one-shot job.
process.stdout.write(JSON.stringify(result), () => process.exit(0));
