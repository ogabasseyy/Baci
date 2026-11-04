import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

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
it('validates the peeked target before consuming the exact bound row', async () => {
  const token = 't'.repeat(43);
  const hash = createHash('sha256').update(token).digest('hex');
  const context = {
    workflowId: id,
    applicationReference: app,
    environment: 'staging' as const,
    hash,
  };
  const row = {
    workflowId: id,
    applicationReference: app,
    environment: 'staging' as const,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    ciphertext: encryptPhoneTarget(
      'https://selfie.example.test/?token=private',
      config.key,
      context
    ),
  };
  rpc
    .mockResolvedValueOnce({ data: row, error: null })
    .mockResolvedValueOnce({ data: { consumed: true }, error: null });
  expect(
    await redeemDurableOxygenHandoff(client, token, config, [
      'https://selfie.example.test',
    ])
  ).toEqual({
    url: 'https://selfie.example.test/?token=private',
  });
  expect(rpc.mock.calls[0][1]).toMatchObject({
    p_operation: 'peek',
    p_hash: hash,
    p_payload: {},
  });
  expect(rpc.mock.calls[1][1]).toMatchObject({
    p_operation: 'consume',
    p_hash: hash,
    p_payload: row,
  });
});
it('does not consume when the peeked target is untrusted or fails validation', async () => {
  const token = 't'.repeat(43);
  const hash = createHash('sha256').update(token).digest('hex');
  const context = {
    workflowId: id,
    applicationReference: app,
    environment: 'staging' as const,
    hash,
  };
  const row = {
    workflowId: id,
    applicationReference: app,
    environment: 'staging' as const,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    ciphertext: encryptPhoneTarget(
      'https://removed.example.test/?token=private',
      config.key,
      context
    ),
  };
  for (const change of [
    {},
    { environment: 'production' },
    { expiresAt: new Date(Date.now() - 1000).toISOString() },
    { applicationReference: id },
  ]) {
    rpc.mockReset();
    rpc.mockResolvedValueOnce({ data: { ...row, ...change }, error: null });
    await expect(
      redeemDurableOxygenHandoff(client, token, config, [
        'https://selfie.example.test',
      ])
    ).rejects.toThrow();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][1].p_operation).toBe('peek');
  }
});
it('can redeem the same capability after an allowed host is restored', async () => {
  const token = 't'.repeat(43);
  const hash = createHash('sha256').update(token).digest('hex');
  const context = {
    workflowId: id,
    applicationReference: app,
    environment: 'staging' as const,
    hash,
  };
  const row = {
    workflowId: id,
    applicationReference: app,
    environment: 'staging' as const,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    ciphertext: encryptPhoneTarget(
      'https://removed.example.test/?token=private',
      config.key,
      context
    ),
  };
  rpc.mockResolvedValueOnce({ data: row, error: null });
  await expect(
    redeemDurableOxygenHandoff(client, token, config, [
      'https://removed.example.test',
    ])
  ).rejects.toThrow();
  expect(rpc).toHaveBeenCalledTimes(1);
  rpc
    .mockResolvedValueOnce({ data: row, error: null })
    .mockResolvedValueOnce({ data: { consumed: true }, error: null });
  await expect(
    redeemDurableOxygenHandoff(
      client,
      token,
      {
        ...config,
        hosts: new Set(['removed.example.test']),
      },
      ['https://removed.example.test']
    )
  ).resolves.toEqual({ url: 'https://removed.example.test/?token=private' });
});
it('never returns the target when the atomic consume loses a race or is replayed', async () => {
  const token = 't'.repeat(43);
  const hash = createHash('sha256').update(token).digest('hex');
  const context = {
    workflowId: id,
    applicationReference: app,
    environment: 'staging' as const,
    hash,
  };
  const row = {
    workflowId: id,
    applicationReference: app,
    environment: 'staging' as const,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    ciphertext: encryptPhoneTarget(
      'https://selfie.example.test/?token=private',
      config.key,
      context
    ),
  };
  rpc
    .mockResolvedValueOnce({ data: row, error: null })
    .mockResolvedValueOnce({ data: null, error: { code: '40001' } });
  await expect(
    redeemDurableOxygenHandoff(client, token, config, [
      'https://selfie.example.test',
    ])
  ).rejects.toThrow();
  rpc.mockResolvedValueOnce({ data: null, error: { code: '40001' } });
  await expect(
    redeemDurableOxygenHandoff(client, token, config, [
      'https://selfie.example.test',
    ])
  ).rejects.toThrow();
});
it('rejects invalid capability syntax before database access', async () => {
  await expect(
    redeemDurableOxygenHandoff(client, 'bad', config, [
      'https://selfie.example.test',
    ])
  ).rejects.toThrow();
  expect(rpc).not.toHaveBeenCalled();
});

afterEach(() => vi.unstubAllEnvs());
it('rejects a misconfigured v3 key before any provider or storage request', async () => {
  vi.stubEnv('OXYGEN_STAGING_PHONE_KEY_V3_WRITE', 'true');
  vi.stubEnv('OXYGEN_STAGING_PHONE_HANDOFF_ENCRYPTION_KEY', '');
  await expect(
    issueDurableOxygenHandoff(client, worker, { call }, 'partner', id, config)
  ).rejects.toThrow();
  expect(call).not.toHaveBeenCalled();
  expect(worker).not.toHaveBeenCalled();
  expect(m.read).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});

it('issues and redeems v3 after writes are disabled, preserving its exact stored context', async () => {
  vi.stubEnv('OXYGEN_STAGING_PHONE_KEY_V3_WRITE', 'true');
  vi.stubEnv('OXYGEN_STAGING_PHONE_HANDOFF_ENCRYPTION_KEY', 'c'.repeat(64));
  await issueDurableOxygenHandoff(
    client,
    worker,
    { call },
    'partner',
    id,
    config
  );
  const token = new URL(m.qr.mock.calls[0][0]).hash.slice(1);
  const issued = rpc.mock.calls[0][1].p_payload;
  expect(issued.ciphertext).toMatch(/^v3\./);
  vi.stubEnv('OXYGEN_STAGING_PHONE_KEY_V3_WRITE', '');
  const stored = {
    workflowId: id,
    applicationReference: app,
    environment: 'staging',
    expiresAt: issued.expiresAt,
    ciphertext: issued.ciphertext,
  };
  rpc.mockResolvedValueOnce({ data: stored, error: null });
  rpc.mockResolvedValueOnce({ data: { consumed: true }, error: null });
  await expect(
    redeemDurableOxygenHandoff(client, token, config, [
      'https://selfie.example.test',
    ])
  ).resolves.toEqual({
    url: 'https://selfie.example.test/?token=private',
  });
  expect(rpc.mock.calls.at(-1)?.[1]).toMatchObject({
    p_operation: 'consume',
    p_payload: stored,
  });
});
