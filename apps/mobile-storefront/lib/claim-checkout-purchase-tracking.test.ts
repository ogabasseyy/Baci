import { CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY } from '@/config/checkout-storage';
import { claimCheckoutPurchaseTracking } from './claim-checkout-purchase-tracking';

const storage = new Map<string, string>();
const mockGetItem = jest.fn(async (key: string) => storage.get(key) ?? null);
const mockSetItem = jest.fn(async (key: string, value: string) => {
  storage.set(key, value);
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: (key: string) => mockGetItem(key),
  setItem: (key: string, value: string) => mockSetItem(key, value),
}));
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  }),
}));

beforeEach(() => {
  storage.clear();
  mockGetItem.mockClear();
  mockSetItem.mockClear();
});

it('tracks the first observed order id and ignores a later replay of the same order', async () => {
  await expect(claimCheckoutPurchaseTracking('order-1')).resolves.toBe(true);
  await expect(claimCheckoutPurchaseTracking('order-1')).resolves.toBe(false);
  await expect(claimCheckoutPurchaseTracking('order-2')).resolves.toBe(true);
});

it('does not re-track a persisted claim after process memory is gone', async () => {
  storage.set(
    CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY,
    JSON.stringify(['order-1'])
  );
  await expect(claimCheckoutPurchaseTracking('order-1')).resolves.toBe(false);
});
