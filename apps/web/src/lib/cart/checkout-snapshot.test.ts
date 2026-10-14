import { expect, it } from 'vitest';
import { parseSnapshot, validOperationId } from './checkout-snapshot';

it('rejects a partial checkout reply and unbounded operation IDs', () => {
  expect(parseSnapshot({ cartId: 'cart', lines: [] })).toBeNull();
  expect(validOperationId('a'.repeat(128))).toBe(true);
  expect(validOperationId('a'.repeat(129))).toBe(false);
});
