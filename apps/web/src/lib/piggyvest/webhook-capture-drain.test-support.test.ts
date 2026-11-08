import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/piggyvest/primary-wallet-bank-inbox-runtime', () => ({
  readPrimaryWalletBankInboxSecrets: () => null,
}));
vi.mock('@/lib/piggyvest/primary-wallet-card-custody-intake-runtime', () => ({
  readPrimaryCardCustodyIntakeSecrets: () => null,
}));
vi.mock('@/lib/piggyvest/primary-wallet-paid-interest-inbox-runtime', () => ({
  readPrimaryWalletPaidInterestInboxSecrets: () => null,
}));

import { piggyvestClaimedCaptureSchema } from '@/schemas/piggyvest/webhook-capture';
import { verifyPiggyvestPayloadSignature } from './verify-piggyvest-payload-signature';
import {
  drainDeps,
  inflow,
  type ResolvedCall,
  row,
  sign,
} from './webhook-capture-drain.test-support';
import { testKey } from './webhook-secret-union.test-support';

const key = testKey('drain-support');
const body = new TextEncoder().encode(inflow);

describe('sign', () => {
  it('produces the signature the provider contract verifies under the key it claims, and no other', () => {
    expect(
      verifyPiggyvestPayloadSignature({
        payload: body,
        signature: sign(key, inflow),
        secret: key,
      })
    ).toBe(true);
    expect(
      verifyPiggyvestPayloadSignature({
        payload: body,
        signature: sign(key, inflow),
        secret: testKey('another'),
      })
    ).toBe(false);
  });
});

describe('row', () => {
  it('builds a claimed capture the queue schema accepts, carrying the stored bytes and event identity', () => {
    const stored = row(inflow, sign(key, inflow));

    expect(piggyvestClaimedCaptureSchema.safeParse(stored).success).toBe(true);
    expect(Buffer.from(stored.raw_hex, 'hex').toString()).toBe(inflow);
    expect(stored.event_type).toBe('bank-transfer.inflow.success');
    expect(stored.provider_transaction_id).toBe('txn-77');
    expect(stored.key_families).toEqual(['legacy']);
  });

  it('lets a test override any field without disturbing the rest', () => {
    const stored = row(inflow, sign(key, inflow), {
      attempts: 7,
      key_families: ['bank'],
    });

    expect(stored).toMatchObject({ attempts: 7, key_families: ['bank'] });
    expect(stored.event_type).toBe('bank-transfer.inflow.success');
  });
});

describe('drainDeps', () => {
  const noop = async () => ({ status: 200 });

  it('hands out the queued batches in order, then nothing', async () => {
    const first = row(inflow, sign(key, inflow));
    const second = row(inflow, sign(key, inflow));
    const deps = drainDeps(
      () => ({ env: { NODE_ENV: 'test' }, resolved: [] }),
      [[first], [second]],
      noop
    );

    expect(await deps.claim(10)).toEqual([first]);
    expect(await deps.claim(10)).toEqual([second]);
    expect(await deps.claim(10)).toEqual([]);
  });

  it('records resolutions into the state read at call time', async () => {
    let resolved: ResolvedCall[] = [];
    const deps = drainDeps(
      () => ({ env: { NODE_ENV: 'test' }, resolved }),
      [],
      noop
    );

    await deps.resolve('id-1', 'token', 'processed', null);
    resolved = [];
    await deps.resolve('id-2', 'token', 'deferred', 'KEYS_UNCONFIGURED');

    expect(resolved).toEqual([
      { id: 'id-2', state: 'deferred', error: 'KEYS_UNCONFIGURED' },
    ]);
  });

  it('verifies against the env read at call time, so a test can swap its keys after building the deps', () => {
    let env: NodeJS.ProcessEnv = { NODE_ENV: 'test' };
    const deps = drainDeps(() => ({ env, resolved: [] }), [], noop);
    const input = {
      rawBody: Buffer.from(body),
      signature: sign(key, inflow),
      recordedFamilies: ['legacy' as const],
    };

    expect(deps.verify(input)).toEqual({ status: 'unconfigured' });
    env = { NODE_ENV: 'test', PIGGYVEST_SECRET_KEY: key };
    expect(deps.verify(input)).toMatchObject({
      status: 'verified',
      secret: key,
      families: ['legacy'],
    });
  });
});
