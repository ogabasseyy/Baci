import { describe, expect, it } from 'vitest';
import {
  buildWalletCreditedPushPayload,
  getStorefrontNotificationNavigationTarget,
} from './push-notification-payloads';

describe('wallet notification payloads', () => {
  it('routes wallet_credited payloads to the wallet with an onward returnTo', () => {
    expect(
      getStorefrontNotificationNavigationTarget({
        type: 'wallet_credited',
        amount: 5000,
        currency: 'NGN',
        returnTo: '/checkout',
      })
    ).toEqual({
      screen: 'wallet',
      params: { credited: 'true', returnTo: '/checkout' },
    });
  });

  it('routes wallet_credited payloads using snake_case return_to', () => {
    expect(
      getStorefrontNotificationNavigationTarget({
        type: 'wallet_credited',
        return_to: '/checkout',
      })
    ).toEqual({
      screen: 'wallet',
      params: { credited: 'true', returnTo: '/checkout' },
    });
  });

  it('routes wallet_credited payloads without a returnTo to the bare wallet, still marked as a credit', () => {
    expect(
      getStorefrontNotificationNavigationTarget({
        type: 'wallet_credited',
        amount: 5000,
      })
    ).toEqual({ screen: 'wallet', params: { credited: 'true' } });
  });

  it('does NOT mark the other wallet-bound pushes as credits', () => {
    expect(
      getStorefrontNotificationNavigationTarget({
        type: 'vtu_cashback_monthly_summary',
      })
    ).toEqual({ screen: 'wallet' });
    expect(
      getStorefrontNotificationNavigationTarget({
        type: 'customer_savings_reminder',
      })
    ).toEqual({ screen: 'wallet', params: { action: 'savings' } });
  });

  it('forwards a savings reminder goalId as savingsGoalId', () => {
    expect(
      getStorefrontNotificationNavigationTarget({
        type: 'customer_savings_reminder',
        goalId: 'goal-older',
        screen: 'wallet',
      })
    ).toEqual({
      screen: 'wallet',
      params: { action: 'savings', savingsGoalId: 'goal-older' },
    });
    expect(
      getStorefrontNotificationNavigationTarget({
        type: 'customer_savings_reminder',
        goal_id: 'goal-older',
      })
    ).toEqual({
      screen: 'wallet',
      params: { action: 'savings', savingsGoalId: 'goal-older' },
    });
  });

  it('omits savingsGoalId when a savings reminder names no goal', () => {
    expect(
      getStorefrontNotificationNavigationTarget({
        type: 'customer_savings_reminder',
        goalId: '   ',
      })
    ).toEqual({ screen: 'wallet', params: { action: 'savings' } });
  });

  it('builds a wallet_credited payload that carries an onward returnTo', () => {
    expect(
      buildWalletCreditedPushPayload({
        amount: 5000,
        currency: 'NGN',
        returnTo: '/utilities/airtime',
      })
    ).toEqual({
      amount: 5000,
      currency: 'NGN',
      returnTo: '/utilities/airtime',
      type: 'wallet_credited',
    });
  });

  it('builds a wallet_credited payload that omits an absent returnTo', () => {
    expect(
      buildWalletCreditedPushPayload({ amount: 5000, currency: 'NGN' })
    ).toEqual({ amount: 5000, currency: 'NGN', type: 'wallet_credited' });
  });
});
