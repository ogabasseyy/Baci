import { createHash } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const m = vi.hoisted(() => ({ read: vi.fn(), runtime: vi.fn(), qr: vi.fn() }));
vi.mock('./runtime-service', () => ({
  readOxygenSnapshot: m.read,
  oxygenRuntimeRpc: m.runtime,
}));
vi.mock('qrcode', () => ({ toDataURL: m.qr }));

import {
  issueDurableOxygenHandoff,
  redeemDurableOxygenHandoff,
} from './durable-phone-handoff';
import { encryptPhoneTarget } from './phone-handoff-crypto';

const id = '60000000-0000-4000-8000-000000000001';
const app = '60000000-0000-4000-8000-000000000002';
const config = {
  environment: 'staging' as const,
  origin: 'https://handoff.example.test',
  key: 'a'.repeat(64),
  hosts: new Set(['selfie.example.test']),
};
const saved = {
  workflowId: id,
  stage: 'kyc_required',
  version: 1,
  environment: 'staging',
  executionEnabled: true,
  approvalOtpReady: false,
  activationEnabled: false,
  settlementEnabled: false,
  state: {
    applicationReference: app,
    validated: true,
    selfieUrl: 'https://selfie.example.test/?token=private',
  },
};
const rpc = vi.fn();
const client = { rpc };
const worker = vi.fn();
const call = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  m.read.mockResolvedValue(saved);
  m.runtime.mockResolvedValue(saved);
  worker.mockResolvedValue(client);
  rpc.mockResolvedValue({ data: { stored: true }, error: null });
  m.qr.mockResolvedValue('data:image/png;base64,synthetic');
});
it('issues a fragment-only QR with encrypted target and no provider mutation', async () => {
  const result = await issueDurableOxygenHandoff(
    client,
    worker,
    { call },
    'partner',
    id,
    config
  );
  expect(result.qr).toMatch(/^data:image/);
  const target = new URL(m.qr.mock.calls[0][0]);
  expect(target.origin).toBe(config.origin);
  expect(target.search).toBe('');
  expect(target.hash.slice(1)).toMatch(/^[\w-]{43}$/);
  const args = rpc.mock.calls[0][1];
  expect(args.p_hash).toBe(
    createHash('sha256').update(target.hash.slice(1)).digest('hex')
  );
  expect(JSON.stringify(args)).not.toContain('private');
  expect(call).not.toHaveBeenCalled();
});
it('rejects ownership, environment and application changes before QR issuance', async () => {
  m.read.mockRejectedValueOnce(new Error('not owner'));
  await expect(
    issueDurableOxygenHandoff(client, worker, { call }, 'partner', id, config)
  ).rejects.toThrow();
  expect(worker).not.toHaveBeenCalled();
  m.runtime.mockResolvedValueOnce({ ...saved, environment: 'production' });
  await expect(
    issueDurableOxygenHandoff(client, worker, { call }, 'partner', id, config)
  ).rejects.toThrow();
  m.runtime.mockResolvedValueOnce({
    ...saved,
    state: { ...saved.state, applicationReference: id },
  });
  await expect(
    issueDurableOxygenHandoff(client, worker, { call }, 'partner', id, config)
  ).rejects.toThrow();
  expect(m.qr).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});
it('does not issue a QR if the database fails to persist the token', async () => {
  rpc.mockResolvedValue({ data: null, error: { code: 'failure' } });
  await expect(
    issueDurableOxygenHandoff(client, worker, { call }, 'partner', id, config)
  ).rejects.toThrow();
});
it('redeems only matching unexpired encrypted targets and never accepts replay errors', async () => {
  const token = 't'.repeat(43);
  const hash = createHash('sha256').update(token).digest('hex');
  const context = {
    workflowId: id,
    applicationReference: app,
    environment: 'staging' as const,
    hash,
  };
  const row = {
    ...context,
    hash: undefined,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    ciphertext: encryptPhoneTarget(
      'https://selfie.example.test/?token=private',
      config.key,
      context
    ),
  };
  delete row.hash;
  rpc.mockResolvedValueOnce({ data: row, error: null });
  expect(await redeemDurableOxygenHandoff(client, token, config)).toEqual({
    url: 'https://selfie.example.test/?token=private',
  });
  rpc.mockResolvedValueOnce({ data: null, error: { code: '40001' } });
  await expect(
    redeemDurableOxygenHandoff(client, token, config)
  ).rejects.toThrow();
  for (const change of [
    { environment: 'production' },
    { expiresAt: new Date(Date.now() - 1000).toISOString() },
    { applicationReference: id },
  ]) {
    rpc.mockResolvedValueOnce({ data: { ...row, ...change }, error: null });
    await expect(
      redeemDurableOxygenHandoff(client, token, config)
    ).rejects.toThrow();
  }
});
it('rejects invalid capability syntax before database access', async () => {
  await expect(
    redeemDurableOxygenHandoff(client, 'bad', config)
  ).rejects.toThrow();
  expect(rpc).not.toHaveBeenCalled();
});
