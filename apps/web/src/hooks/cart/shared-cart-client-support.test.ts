import { expect, it } from 'vitest';
import { failureOf } from './shared-cart-client-support';

it('normalizes a definitive bootstrap-scope rejection for preserved-session adoption', () => {
  expect(failureOf({ code: 'forbidden' }, 403)).toEqual({
    code: 'unauthorized',
    ok: false,
    retryable: false,
    snapshot: null,
  });
});
