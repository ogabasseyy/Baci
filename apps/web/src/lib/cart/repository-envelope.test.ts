import { expect, it } from 'vitest';
import {
  CartRepositoryError,
  parseRawMutationResult,
} from './repository-envelope';

it('preserves merchant_unavailable RPC failures instead of masking them', () => {
  expect(
    parseRawMutationResult({ code: 'merchant_unavailable', ok: false })
  ).toMatchObject({ code: 'merchant_unavailable', ok: false });
});

it('fails closed on a malformed successful RPC envelope', () => {
  expect(() =>
    parseRawMutationResult({ ok: true, state: { lines: [] } })
  ).toThrow(CartRepositoryError);
});
