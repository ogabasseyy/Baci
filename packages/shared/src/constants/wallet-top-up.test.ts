import { describe, expect, it } from 'vitest';
import {
  WALLET_TOP_UP_MAX_AMOUNT,
  WALLET_TOP_UP_MIN_AMOUNT,
} from './wallet-top-up';

describe('wallet top-up limits (shared oracle)', () => {
  it('pins the NGN limits both surfaces validate against', () => {
    expect(WALLET_TOP_UP_MIN_AMOUNT).toBe(100);
    expect(WALLET_TOP_UP_MAX_AMOUNT).toBe(500_000);
  });
});
