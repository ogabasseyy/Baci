import { createHmac, randomBytes } from 'node:crypto';
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

import { verifyStoredPiggyvestDelivery } from './verify-stored-piggyvest-delivery';
import { drainPiggyvestWebhookCaptures } from './webhook-capture-drain';

const body = JSON.stringify({ eventId: 'evt-q', eventType: 'x' });

function setup(result: { status: number; authorizationQuarantine?: boolean }) {
  const key = randomBytes(32).toString('hex');
  const resolved: { state: string; error: string | null }[] = [];
  const row = {
    capture_id: crypto.randomUUID(),
    claim_token: crypto.randomUUID(),
    raw_hex: Buffer.from(body).toString('hex'),
    signature: createHmac('sha512', key).update(body).digest('hex'),
    key_version: 'k-0123456789abcdef',
    key_families: ['legacy' as const],
    attempts: 1,
    event_type: 'x',
    provider_transaction_id: null,
  };
  const deps = {
    claim: async () => [row],
    resolve: async (
      _id: string,
      _token: string,
      state: 'pending' | 'processed' | 'needs_review',
      error: string | null
    ) => {
      resolved.push({ state, error });
      return true;
    },
    verify: (input: { rawBody: Buffer; signature: string }) =>
      verifyStoredPiggyvestDelivery({
        ...input,
        env: { NODE_ENV: 'test' as const, PIGGYVEST_SECRET_KEY: key },
      }),
    process: async () => result,
  };
  return { deps, resolved };
}

describe('authorization quarantine during replay', () => {
  it('never resolves a wrong-family quarantine as processed', async () => {
    const { deps, resolved } = setup({
      status: 200,
      authorizationQuarantine: true,
    });

    const summary = await drainPiggyvestWebhookCaptures(deps);

    expect(resolved).toEqual([
      { state: 'pending', error: 'PROCESSING_INCOMPLETE' },
    ]);
    expect(summary).toMatchObject({ processed: 0, retried: 1 });
  });

  it('still resolves an ordinary completed result as processed', async () => {
    const { deps, resolved } = setup({ status: 200 });

    await drainPiggyvestWebhookCaptures(deps);

    expect(resolved).toEqual([{ state: 'processed', error: null }]);
  });
});
