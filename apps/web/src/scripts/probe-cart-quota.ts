import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { verifyQuotaOperatorProbe } from '@/lib/cart/quota-operator-probe';
import { createCartQuotaScopedClient } from '@/lib/cart/scoped-client';

export async function runCartQuotaProbe(args: readonly string[]): Promise<void> {
  if (!args.includes('--execute')) {
    throw new Error('Pass --execute in an approved server environment');
  }
  const client = createCartQuotaScopedClient(`operator-probe:${randomUUID()}`, 60_000);
  await verifyQuotaOperatorProbe(async (name) => {
    const { data, error } = await client
      .rpc(name)
      .abortSignal(AbortSignal.timeout(3000));
    return { data, error: error ? { message: error.message } : null };
  });
}

const currentFile = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (import.meta.url === currentFile) {
  runCartQuotaProbe(process.argv.slice(2))
    .then(() => console.log('Cart quota counter and scope probe passed.'))
    .catch(() => {
      console.error('Cart quota probe failed. Check server configuration and guard.');
      process.exitCode = 1;
    });
}
