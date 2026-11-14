import { afterEach, describe, expect, it, vi } from 'vitest';
import { ok } from './mock-sandbox-types';
import { runFeeBearerAndRestrictions } from './proof-6-owner-gaps';
import { ProofBuilder } from './proof-builder';
import { setupScenario } from './scenario';
import { makeHarness } from './test-harness.test-support';
import type { ProofResult } from './types';

let dispose: (() => void) | null = null;
afterEach(() => {
  dispose?.();
  vi.restoreAllMocks();
});
function harness(...args: Parameters<typeof makeHarness>) {
  const h = makeHarness(...args);
  dispose = h.dispose;
  return h;
}
const answer = (result: ProofResult, id: string) =>
  result.findings.find((f) => f.id === id)?.answer;

async function gaps(h: ReturnType<typeof harness>, setup = true) {
  if (setup) await setupScenario(h.ctx);
  const b = new ProofBuilder('p6', 'Fees');
  await runFeeBearerAndRestrictions(h.ctx, b);
  return b.build(h.ctx);
}

describe('proof 6: fee bearer and restriction gaps', () => {
  it('records the fee-wallet and Lien/Freeze questions as not observable here, without sending anything', async () => {
    const h = harness();
    await setupScenario(h.ctx);
    const posts = h.mock.calls.filter((c) => c.method === 'POST').length;
    const result = await gaps(h, false);
    expect(h.mock.calls.filter((c) => c.method === 'POST').length).toBe(posts);
    for (const id of [
      'fee_wallet_bears_transfer_fee',
      'restriction_webhook_payload',
      'restriction_blocks_business_transfer',
    ]) {
      expect(answer(result, id)).toBe('unknown');
      expect(result.findings.find((f) => f.id === id)?.detail).toBeTruthy();
    }
    // The mock readback carries no restriction flags.
    expect(answer(result, 'wallet_readback_shows_restriction_flags')).toBe(
      'no'
    );
    expect(result.status).toBe('observed');
  });

  it('names the restriction flags a wallet readback carries', async () => {
    const h = harness();
    await setupScenario(h.ctx);
    const real = h.mock.sandbox.retrieveWallet.bind(h.mock.sandbox);
    vi.spyOn(h.mock.sandbox, 'retrieveWallet').mockImplementation((id) => {
      const reply = real(id);
      const data = (reply.body as { data: Record<string, unknown> }).data;
      return ok({ ...data, is_frozen: false, has_an_active_lien: false });
    });
    const result = await gaps(h, false);
    expect(answer(result, 'wallet_readback_shows_restriction_flags')).toBe(
      'yes'
    );
    expect(result.values).toMatchObject({
      wallet_restriction_field_names: 'has_an_active_lien,is_frozen',
      main_wallet_is_frozen: false,
      main_wallet_has_an_active_lien: false,
    });
  });

  it('is inconclusive when no main wallet can be read', async () => {
    const h = harness({ mode: 'live-readonly' });
    const result = await gaps(h);
    expect(answer(result, 'wallet_readback_shows_restriction_flags')).toBe(
      'unknown'
    );
    expect(result.status).toBe('inconclusive');
  });
});
