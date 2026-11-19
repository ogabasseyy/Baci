import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createMockProvider, MOCK_API_KEY } from './mock-provider';
import { parseRunConfig, type RunConfig } from './run-mode';
import type { runHarness } from './runner';

export const noSleep = () => Promise.resolve();

export const QA = 'qa-customer-0001';
export function tempDir() {
  return mkdtempSync(path.join(tmpdir(), 'pvb-runner-'));
}
export function allowlistFile(ids: string[] = [QA]) {
  const file = path.join(tempDir(), 'allowlist.json');
  writeFileSync(file, JSON.stringify({ qaCustomerIds: ids }));
  return file;
}
export const env = {
  PVB_PROOF_API_KEY: MOCK_API_KEY,
  PVB_PROOF_BANK_CODE: '058',
  PVB_PROOF_BANK_ACCOUNT: '0123456789',
  // The mock's business wallet id is deterministic.
  PVB_PROOF_BUSINESS_WALLET_ID: createMockProvider().sandbox.businessWalletId,
};
export function config(
  args: string[],
  extra: Partial<RunConfig> = {}
): RunConfig {
  return { ...parseRunConfig(args, env), ...extra };
}
export function liveConfig(
  mode: '--live-readonly' | '--live-sandbox-mutations',
  extra: Partial<RunConfig> = {}
) {
  const dir = tempDir();
  return config(
    [
      mode,
      '--allowlist',
      allowlistFile(),
      '--journal',
      path.join(dir, 'journal.jsonl'),
      '--evidence-dir',
      path.join(dir, 'evidence'),
    ],
    extra
  );
}
export const posts = (mock: ReturnType<typeof createMockProvider>) =>
  mock.calls
    .filter((call) => call.method === 'POST')
    .map((call) => call.pathname);
export const statuses = (summary: Awaited<ReturnType<typeof runHarness>>) =>
  Object.fromEntries(summary.proofs.map((p) => [p.proof, p.status]));
