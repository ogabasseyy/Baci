import { router } from 'expo-router';
import { runSavingsCardAuthorization } from './run-savings-card-authorization';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/components/ui/show-app-alert', () => ({
  showAppAlert: jest.fn(),
}));
jest.mock('@/lib/customer-savings', () => ({
  initializeSavingsAuthorization: jest.fn(async () => ({
    authorization_url: 'https://example.test/authorization',
    gateway: 'paystack',
    reference: 'synthetic',
  })),
}));

describe('runSavingsCardAuthorization with PiggyVest off', () => {
  it('closes the review sheet and opens the card authorization screen', async () => {
    const input = {
      activeMerchantId: 'merchant-1',
      activeMerchantSlug: 'ogabassey',
      setShowFundingModal: jest.fn(),
      setShowPreviewModal: jest.fn(),
      setFormError: jest.fn(),
    };
    await runSavingsCardAuthorization(input as never, () => true);
    expect(input.setShowPreviewModal).toHaveBeenCalledWith(false);
    expect(input.setShowFundingModal).toHaveBeenCalledWith(false);
    expect(router.push).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/payment-gateway' })
    );
  });
});
