import { expect, it } from 'vitest';
import { buildLegacyHandoffOperationId } from './build-legacy-handoff-operation-id';

it('uses fresh operation identities on import reads without an explicit key', () => {
  const first = buildLegacyHandoffOperationId('cart-a', undefined, true);
  expect(first).toMatch(/^legacy-handoff:mcp-import:[a-f0-9]{64}$/);
  expect(buildLegacyHandoffOperationId('cart-a', undefined, true)).not.toBe(
    first
  );
});

it('keeps retry identities stable and isolates import keys from ordinary handoffs', () => {
  const first = buildLegacyHandoffOperationId('cart-a', 'same', true);
  expect(buildLegacyHandoffOperationId('cart-a', 'same', true)).toBe(first);
  expect(buildLegacyHandoffOperationId('cart-a', 'same', false)).not.toBe(
    first
  );
});
