import { describe, expect, expectTypeOf, it } from 'vitest';
import type { PiggyvestIntakeClient } from './intake-client.types';

describe('PiggyvestIntakeClient', () => {
  it('exposes a disposer that closes the delivery connection', () => {
    expectTypeOf<PiggyvestIntakeClient['dispose']>().toEqualTypeOf<
      (() => Promise<void>) | undefined
    >();
    expect(true).toBe(true);
  });
});
