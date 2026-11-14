import { describe, expect, it } from '@jest/globals';
import {
  DEFAULT_SAVINGS_FALLBACK_TITLE,
  type PaymentMethodSelectorProps,
} from './types';

// The new store-credit flag is optional, so every existing caller (and the
// server-off build) keeps the wallet wording by default.
describe('payment method selector props with the server off', () => {
  it('leaves walletIsStoreCredit optional and keeps the shared defaults', () => {
    const props: Pick<PaymentMethodSelectorProps, 'walletIsStoreCredit'> = {};
    expect(props.walletIsStoreCredit).toBeUndefined();
    expect(DEFAULT_SAVINGS_FALLBACK_TITLE).toBe('device savings');
  });
});
