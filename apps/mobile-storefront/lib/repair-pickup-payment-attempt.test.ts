import * as SecureStore from 'expo-secure-store';
import { repairPickupPaymentAttempt } from './repair-pickup-payment-attempt';

jest.mock('expo-constants', () => ({
  expoConfig: { extra: { merchantSlug: 'test' } },
}));
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'sha256' },
  digestStringAsync: jest.fn(async () => 'digest'),
  randomUUID: () => '14bf2192-16de-442b-bf75-700f4ff2aaca',
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
const data = {
  customerName: 'Test',
  customerEmail: 'test@example.com',
  customerPhone: '08012345678',
  deviceType: 'Smartphone' as const,
  deviceModel: 'iPhone',
  issueDescription: 'Broken screen',
  serviceType: 'pickup' as const,
  pickupAddress: '10 Test Street, Osun',
};
describe('durable pickup attempt', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(SecureStore.setItemAsync).mockResolvedValue(undefined);
  });
  it('restores exactly the identity saved before the first request', async () => {
    jest.mocked(SecureStore.getItemAsync).mockResolvedValueOnce(null);
    const first = await repairPickupPaymentAttempt.get(data, 3000);
    const saved = jest.mocked(SecureStore.setItemAsync).mock.calls[0][1];
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue(saved);
    expect(await repairPickupPaymentAttempt.get(data, 3000)).toBe(first);
    expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
  });
  it('fails closed if the pre-request write fails', async () => {
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue(null);
    jest.mocked(SecureStore.setItemAsync).mockRejectedValue(new Error('Full'));
    await expect(repairPickupPaymentAttempt.get(data, 3000)).rejects.toThrow(
      'Full'
    );
  });
  it('rejects changed fees while the previous attempt remains unresolved', async () => {
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue(
      JSON.stringify({
        requestId: '14bf2192-16de-442b-bf75-700f4ff2aaca',
        expectedPickupFee: 3000,
      })
    );
    await expect(repairPickupPaymentAttempt.get(data, 4000)).rejects.toThrow(
      'previous pickup payment'
    );
  });
});
