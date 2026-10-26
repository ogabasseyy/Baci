import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function receiverSourceRoot() {
  const configured = process.env.BACI_CONTRACT_E2E_RECEIVER_ROOT;
  if (configured === undefined)
    return '/Users/mac/.codex/worktrees/0d77/Baci-app';
  try {
    if (!isAbsolute(configured)) throw new Error();
    const root = realpathSync(configured);
    if (
      !statSync(root).isDirectory() ||
      !statSync(resolve(root, 'apps/web/tools/piggyvest-staging')).isDirectory()
    )
      throw new Error();
    return root;
  } catch {
    throw new Error('Contract receiver source root refused');
  }
}

export const CONTRACT_E2E = Object.freeze({
  canonicalRoot: fileURLToPath(new URL('../../../../', import.meta.url)),
  receiverRoot: receiverSourceRoot(),
  postgresBin: '/opt/homebrew/opt/postgresql@18/bin',
  port: '55463',
  integrationId: '40000000-0000-4000-8000-000000000001',
  merchantId: '10000000-0000-4000-8000-000000000001',
  customerId: '20000000-0000-4000-8000-000000000001',
  goalId: '30000000-0000-4000-8000-000000000001',
  userId: '50000000-0000-4000-8000-000000000001',
  businessId: 'synthetic-account',
  signingSecret: 'synthetic-contract-e2e-not-provider-material',
  integrationToken: 'ab'.repeat(32),
  encryptionKey: Buffer.alloc(32, 7),
  fractionalKobo: '406.8493150684931234',
  runtimeStoragePin: '7686901100561231906',
});
