import { execFileSync } from 'node:child_process';
import {
  accessSync,
  constants as fsConstants,
  realpathSync,
  statSync,
} from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function configuredDirectory(envName, label, validate) {
  const configured = process.env[envName];
  if (configured === undefined) throw new Error(`${label} required`);
  try {
    if (!isAbsolute(configured)) throw new Error();
    const root = realpathSync(configured);
    if (!statSync(root).isDirectory()) throw new Error();
    validate(root);
    return root;
  } catch {
    throw new Error(`${label} refused`);
  }
}

function receiverSourceRoot() {
  return configuredDirectory(
    'BACI_CONTRACT_E2E_RECEIVER_ROOT',
    'Contract receiver source root',
    (root) => {
      if (
        !statSync(
          resolve(root, 'apps/web/tools/piggyvest-staging')
        ).isDirectory()
      )
        throw new Error();
    }
  );
}

function postgresBinaryRoot() {
  return configuredDirectory(
    'BACI_CONTRACT_E2E_POSTGRES_BIN',
    'Contract PostgreSQL 18 binary directory',
    (root) => {
      for (const binary of ['initdb', 'pg_ctl', 'postgres', 'psql']) {
        const path = resolve(root, binary);
        if (!statSync(path).isFile()) throw new Error();
        accessSync(path, fsConstants.X_OK);
        const version = execFileSync(path, ['--version'], {
          encoding: 'utf8',
          timeout: 5000,
          maxBuffer: 4096,
        });
        if (!/\bPostgreSQL\b[^\r\n]*\b18(?:\.\d+)*\b/i.test(version))
          throw new Error();
      }
    }
  );
}

export const CONTRACT_E2E = Object.freeze({
  canonicalRoot: fileURLToPath(new URL('../../../../', import.meta.url)),
  receiverRoot: receiverSourceRoot(),
  postgresBin: postgresBinaryRoot(),
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
