import { expect, it } from 'vitest';
import {
  CartRepositoryError,
  parseRawMutationResult,
} from './repository-envelope';

it('fails closed on a malformed successful RPC envelope', () => {
  expect(() =>
    parseRawMutationResult({ ok: true, state: { lines: [] } })
  ).toThrow(CartRepositoryError);
});
