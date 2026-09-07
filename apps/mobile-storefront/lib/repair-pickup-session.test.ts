import * as SecureStore from 'expo-secure-store';
import { repairPickupSession } from './repair-pickup-session';

jest.mock('expo-constants', () => ({
  expoConfig: { extra: { merchantSlug: 'test' } },
}));
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'sha256' },
  digestStringAsync: jest.fn(async (_algorithm, value) =>
    value.length.toString()
  ),
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));
const data = {
  customerName: 'Test',
  customerEmail: 'test@example.com',
  customerPhone: '08012345678',
  deviceType: 'Smartphone' as const,
  deviceModel: 'iPhone',
  issueDescription: 'Broken screen',
  serviceType: 'pickup' as const,
  pickupAddress: '10 Test Road, Osogbo, Osun',
};
describe('repairPickupSession', () => {
  beforeEach(() => jest.clearAllMocks());
  it('saves payment recovery in secure storage and restores it', async () => {
    const saved = { resumeToken: 'token', ticketNumber: 123, price: 3000 };
    jest
      .mocked(SecureStore.getItemAsync)
      .mockResolvedValue(JSON.stringify(saved));
    await repairPickupSession.save(data, saved);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      expect.stringMatching(/^repair-pickup-/),
      JSON.stringify(saved)
    );
    await expect(repairPickupSession.load(data)).resolves.toEqual(saved);
  });
  it('fails closed on corrupt recovery instead of treating it as a new booking', async () => {
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue('bad JSON');
    await expect(repairPickupSession.load(data)).rejects.toThrow();
  });
});
