import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { redeemDurableOxygenHandoff } from './durable-phone-handoff';
import { encryptPhoneTarget } from './phone-handoff-crypto';

const token = 't'.repeat(43);
const hash = createHash('sha256').update(token).digest('hex');
const context = {
  hash,
  workflowId: '60000000-0000-4000-8000-000000000001',
  applicationReference: '60000000-0000-4000-8000-000000000002',
  environment: 'staging' as const,
};
const config = {
  environment: 'staging' as const,
  origin: 'https://handoff.example.test',
  key: 'a'.repeat(64),
  hosts: new Set(['selfie.example.test']),
};
function makeWorker(target = 'https://selfie.example.test/?token=private') {
  const row = {
    ...context,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    ciphertext: encryptPhoneTarget(target, config.key, context),
  };
  const { hash: _hash, ...storedRow } = row;
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ data: storedRow, error: null })
    .mockResolvedValueOnce({ data: { consumed: true }, error: null });
  return { rpc };
}

it.each([
  { browserOrigins: [] },
  { browserOrigins: ['https://old-selfie.example.test'] },
])('does not consume when the current page cannot open the target: $browserOrigins', async ({
  browserOrigins,
}) => {
  const worker = makeWorker();
  await expect(
    redeemDurableOxygenHandoff(worker, token, config, browserOrigins)
  ).rejects.toThrow();
  expect(worker.rpc).toHaveBeenCalledTimes(1);
  expect(worker.rpc.mock.calls[0][1].p_operation).toBe('peek');
});

it('never expands the server allowlist based on the browser input', async () => {
  const worker = makeWorker('https://evil.example.test/selfie');
  await expect(
    redeemDurableOxygenHandoff(worker, token, config, [
      'https://evil.example.test',
    ])
  ).rejects.toThrow();
  expect(worker.rpc).toHaveBeenCalledTimes(1);
});

it('consumes only when both the server and page allow the same target', async () => {
  const worker = makeWorker();
  await expect(
    redeemDurableOxygenHandoff(worker, token, config, [
      'https://selfie.example.test',
    ])
  ).resolves.toEqual({ url: 'https://selfie.example.test/?token=private' });
  expect(worker.rpc).toHaveBeenCalledTimes(2);
  expect(worker.rpc.mock.calls[1][1].p_operation).toBe('consume');
});
