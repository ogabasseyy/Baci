import type { CartSnapshot } from '@baci/shared/cart';
import { afterEach, expect, it } from 'vitest';
import {
  clearHandoffAttempt,
  type PreviewResponse,
  recordAttemptBody,
  recordAttemptChoice,
} from './cart-handoff-support';
import { prepareHandoffRedeemBody } from './prepare-handoff-redeem-body';

const handoffId = 'transfer';
const token = 'ch1.fixture.signature';
const snapshot: CartSnapshot = {
  cartId: 'from-cart',
  currency: 'NGN',
  estimatedTotals: false,
  expiresAt: '2099-01-01T00:00:00Z',
  lines: [],
  merchantId: 'merchant',
  state: 'active',
  subtotalMinor: 0,
  totalMinor: 0,
  version: 4,
};
const preview: PreviewResponse = {
  snapshot,
  importMcp: true,
  status: 'pending',
  merchant: null,
  expiresAt: null,
};
const destination = { ...snapshot, cartId: 'to-cart', version: 2 };

afterEach(() => clearHandoffAttempt(handoffId));

it.each([
  'connect',
  'merge',
  'keep_existing',
] as const)('includes both cart versions for %s', (choice) => {
  expect(
    prepareHandoffRedeemBody(preview, destination, handoffId, token, choice)
  ).toMatchObject({
    choice,
    expectedIncomingVersion: 4,
    expectedDestVersion: 2,
    destCartId: 'to-cart',
  });
});

it('omits the destination revision only for an MCP import', () => {
  const request = prepareHandoffRedeemBody(
    preview,
    destination,
    handoffId,
    token,
    'import_mcp'
  );
  expect(request).toMatchObject({
    choice: 'import_mcp',
    expectedIncomingVersion: 4,
    destCartId: 'to-cart',
  });
  expect(request).not.toHaveProperty('expectedDestVersion');
});

it('replays the stored request exactly even after a cart version changes', () => {
  const original = {
    token,
    handoffId,
    attemptId: 'first',
    choice: 'import_mcp',
    expectedIncomingVersion: 3,
  };
  recordAttemptBody(handoffId, original);
  expect(
    prepareHandoffRedeemBody(
      preview,
      destination,
      handoffId,
      token,
      'import_mcp'
    )
  ).toEqual(original);
});

it('requires a snapshot and respects the signed import mode and prior choice', () => {
  expect(
    prepareHandoffRedeemBody(
      { ...preview, snapshot: null },
      destination,
      handoffId,
      token,
      'connect'
    )
  ).toBeNull();
  expect(
    prepareHandoffRedeemBody(
      { ...preview, importMcp: false },
      destination,
      handoffId,
      token,
      'import_mcp'
    )
  ).toBeNull();
  recordAttemptChoice(handoffId, 'merge');
  expect(
    prepareHandoffRedeemBody(
      preview,
      destination,
      handoffId,
      token,
      'import_mcp'
    )
  ).toBeNull();
});
