import { Alert } from 'react-native';
import { resolvePersistedRedvaultOrder } from '@/lib/pending-redvault-order';
import { createStorefrontCustomerApiClient } from '@/lib/storefront-customer-api-client';
import { resolveCheckoutRedvaultFence } from './resolve-checkout-redvault-fence';

jest.mock('@/lib/pending-redvault-order', () => ({
  resolvePersistedRedvaultOrder: jest.fn(),
}));
jest.mock('@/lib/storefront-customer-api-client', () => ({
  createStorefrontCustomerApiClient: jest.fn(),
}));
jest.mock('react-native', () => ({
  Alert: { alert: jest.fn() },
}));

const mockResolve = resolvePersistedRedvaultOrder as jest.Mock;
const mockCreateClient = createStorefrontCustomerApiClient as jest.Mock;
const mockAlert = Alert.alert as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateClient.mockReturnValue({ fetchJson: jest.fn() });
});

describe('resolveCheckoutRedvaultFence', () => {
  it('proceeds when no fence blocks checkout', async () => {
    mockResolve.mockResolvedValue({ blocked: false });

    await expect(resolveCheckoutRedvaultFence()).resolves.toBe(true);
    expect(mockResolve).toHaveBeenCalledWith({
      validateOrder: expect.any(Function),
    });
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it('blocks checkout while the fence is unresolved', async () => {
    mockResolve.mockResolvedValue({ blocked: true, orderId: 'order-rv' });

    await expect(resolveCheckoutRedvaultFence()).resolves.toBe(false);
    expect(mockAlert).toHaveBeenCalledWith(
      'Payment still processing',
      expect.stringMatching(/still being verified/i)
    );
  });

  it('blocks checkout when fence validation throws', async () => {
    mockResolve.mockRejectedValue(new Error('network down'));

    await expect(resolveCheckoutRedvaultFence()).resolves.toBe(false);
    expect(mockAlert).toHaveBeenCalledWith(
      'Unable to verify pending payment',
      expect.stringMatching(/could not check/i)
    );
  });
});
