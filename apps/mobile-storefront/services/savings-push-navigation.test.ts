import { describe, expect, it } from '@jest/globals';
import { getSavingsPushNavigationTarget } from './savings-push-navigation';

describe('getSavingsPushNavigationTarget', () => {
  const merchantId = '00000000-0000-4000-8000-000000000010';

  it('opens the worker savings payload in the wallet savings panel', () => {
    expect(
      getSavingsPushNavigationTarget(
        {
          goalId: '00000000-0000-4000-8000-000000000002',
          merchantId,
          notificationId: '00000000-0000-4000-8000-000000000001',
          type: 'savings',
        },
        merchantId
      )
    ).toEqual({
      params: { action: 'savings' },
      screen: 'wallet',
    });
  });

  it('does not route untrusted identifiers, non-savings events, or another merchant', () => {
    expect(
      getSavingsPushNavigationTarget(
        {
          goalId: 'not-a-uuid',
          merchantId,
          notificationId: '00000000-0000-4000-8000-000000000001',
          type: 'savings',
        },
        merchantId
      )
    ).toBeNull();
    expect(
      getSavingsPushNavigationTarget(
        {
          goalId: '00000000-0000-4000-8000-000000000002',
          merchantId,
          notificationId: '00000000-0000-4000-8000-000000000001',
          type: 'order_shipped',
        },
        merchantId
      )
    ).toBeNull();
    expect(
      getSavingsPushNavigationTarget(
        {
          goalId: '00000000-0000-4000-8000-000000000002',
          merchantId: '00000000-0000-4000-8000-000000000011',
          notificationId: '00000000-0000-4000-8000-000000000001',
          type: 'savings',
        },
        merchantId
      )
    ).toBeNull();
  });
});
