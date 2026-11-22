import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { confirmGiftCardPilot, issueGiftCardPilotQuote } from './pilot-wallet';

import { PILOT_APPROVED_KOBO, PILOT_PRODUCT_ID } from './pilot-wallet-config';

const approved = 1673573;
const userId = '10000000-0000-4000-8000-000000000001';
const orderId = '50000000-0000-4000-8000-000000000001';

function setup() {
  const proof = {
    payload: JSON.stringify({
      id: orderId,
      userId,
      cardId: '2844',
      totalKobo: approved,
    }),
    signature: 'test-signature',
  };
  const deps = {
    getUserId: vi.fn().mockResolvedValue(userId),
    readPetrockOffer: vi.fn().mockResolvedValue(true),
    issue: vi.fn().mockResolvedValue({
      totalKobo: approved,
      proof,
      expiresAt: Date.now() + 60_000,
    }),
    confirm: vi
      .fn()
      .mockResolvedValue({ order_id: orderId, order_status: 'paid' }),
  };
  return {
    deps,
    config: { userId, orderId, presentationKey: 't'.repeat(48) },
    proof,
  };
}

it('uses the one pilot order ID across price refreshes and confirms the unchanged approved total', async () => {
  const { deps, config, proof } = setup();
  const shown = await issueGiftCardPilotQuote(config, deps);
  expect(shown).not.toHaveProperty('proof');
  await confirmGiftCardPilot(shown, config, deps);
  expect(deps.issue.mock.calls).toEqual([
    [{ cardId: '2844' }, orderId],
    [{ cardId: '2844' }, orderId],
  ]);
  expect(deps.confirm).toHaveBeenCalledExactlyOnceWith(proof);
});

it('does not debit when the quote changes at confirmation', async () => {
  const { deps, config } = setup();
  const shown = await issueGiftCardPilotQuote(config, deps);
  deps.issue.mockResolvedValue({ totalKobo: approved + 1 });
  await expect(confirmGiftCardPilot(shown, config, deps)).rejects.toThrow(
    'Price changed'
  );
  expect(deps.confirm).not.toHaveBeenCalled();
});

it('refuses another customer and never calls the wallet or provider', async () => {
  const { deps, config } = setup();
  const shown = await issueGiftCardPilotQuote(config, deps);
  deps.issue.mockClear();
  deps.readPetrockOffer.mockClear();
  deps.getUserId.mockResolvedValue('other-user');
  await expect(confirmGiftCardPilot(shown, config, deps)).rejects.toThrow(
    'unavailable'
  );
  expect(deps.issue).not.toHaveBeenCalled();
  expect(deps.readPetrockOffer).not.toHaveBeenCalled();
  expect(deps.confirm).not.toHaveBeenCalled();
});

it('refuses a fresh quote that is already expired even when the displayed quote is still valid', async () => {
  const { deps, config, proof } = setup();
  const shown = await issueGiftCardPilotQuote(config, deps);
  deps.issue.mockResolvedValue({ totalKobo: approved, proof, expiresAt: 1 });
  await expect(confirmGiftCardPilot(shown, config, deps)).rejects.toThrow(
    'Fresh price expired'
  );
  expect(deps.confirm).not.toHaveBeenCalled();
});

it('keeps the worker SQL allowlist bound to the checkout pilot economics', () => {
  const sql = readFileSync(
    new URL(
      '../../../../../supabase/migrations/20261121210000_scope_gift_card_worker_to_pilot.sql',
      import.meta.url
    ),
    'utf8'
  );
  expect(sql).toContain(
    `p_product_id = '${PILOT_PRODUCT_ID}' AND p_amount_kobo = ${PILOT_APPROVED_KOBO}`
  );
});

it('requests a fresh price if confirmation fields are malformed', async () => {
  const { deps, config } = setup();
  await expect(
    confirmGiftCardPilot({ expiresAt: Number.NaN, token: null }, config, deps)
  ).rejects.toThrow('Please request a fresh price before confirming.');
  expect(deps.readPetrockOffer).not.toHaveBeenCalled();
  expect(deps.confirm).not.toHaveBeenCalled();
});
