import { fileURLToPath } from 'node:url';

export const CONTRACT_E2E = Object.freeze({
  canonicalRoot: fileURLToPath(new URL('../../../../', import.meta.url)),
  receiverRoot: '/Users/mac/.codex/worktrees/0d77/Baci-app',
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
