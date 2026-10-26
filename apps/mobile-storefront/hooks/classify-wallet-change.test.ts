import { classifyWalletChange } from './classify-wallet-change';
import { walletGoalMetadata } from './wallet-goal-metadata';
import type { WalletQueryData } from './wallet-query';

const goal = {
  id: 'plan',
  product_id: 'phone',
  title: 'Phone',
  target_amount: 1000,
  current_amount: 100,
  status: 'active',
};
const cached: WalletQueryData = {
  wallet: { balance: 0, loyalty_points: 0 },
  transactions: [],
  walletId: 'wallet',
  goalMetadata: { plan: walletGoalMetadata(goal) ?? '' },
};
const scope = { merchantId: 'merchant', customerId: 'customer' };
const payload = {
  eventType: 'UPDATE',
  new: {
    ...goal,
    merchant_id: 'merchant',
    customer_id: 'customer',
    current_amount: 200,
  },
};
it('refreshes amounts only when the full plan metadata is unchanged', () => {
  expect(
    classifyWalletChange('customer_savings_goals', payload, cached, scope)
  ).toBe('numbers');
});
it.each([
  { title: 'New phone' },
  { product_id: 'other' },
  { variant_id: 'other' },
  { product_snapshot: { image: 'other.jpg' } },
  { target_amount: 2000 },
  { status: 'completed' },
])('reloads changed plan details instead of keeping stale metadata: %s', (change) => {
  expect(
    classifyWalletChange(
      'customer_savings_goals',
      { ...payload, new: { ...payload.new, ...change } },
      cached,
      scope
    )
  ).toBe('full');
});
it('ignores a foreign merchant or customer event', () => {
  expect(
    classifyWalletChange(
      'customer_savings_goals',
      { ...payload, new: { ...payload.new, merchant_id: 'other' } },
      cached,
      scope
    )
  ).toBe('ignore');
  expect(
    classifyWalletChange(
      'customer_savings_goals',
      { ...payload, new: { ...payload.new, customer_id: 'other' } },
      cached,
      scope
    )
  ).toBe('ignore');
});
it('reloads inserts, deletions and unknown payloads without guessing an amount', () => {
  expect(
    classifyWalletChange(
      'customer_savings_goals',
      { ...payload, eventType: 'INSERT' },
      cached,
      scope
    )
  ).toBe('full');
  expect(
    classifyWalletChange(
      'customer_savings_goals',
      { eventType: 'DELETE', old: payload.new },
      cached,
      scope
    )
  ).toBe('full');
  expect(
    classifyWalletChange('customer_wallets', undefined, cached, scope)
  ).toBe('full');
});
it('refreshes bank-credit history only for the scoped wallet', () => {
  expect(
    classifyWalletChange(
      'customer_wallet_transactions',
      {
        eventType: 'INSERT',
        new: { wallet_id: 'wallet', merchant_id: 'merchant' },
      },
      cached,
      scope
    )
  ).toBe('history');
  expect(
    classifyWalletChange(
      'customer_wallet_transactions',
      {
        eventType: 'INSERT',
        new: { wallet_id: 'other', merchant_id: 'merchant' },
      },
      cached,
      scope
    )
  ).toBe('ignore');
});
