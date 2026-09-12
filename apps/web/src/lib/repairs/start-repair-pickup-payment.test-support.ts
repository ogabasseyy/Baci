import { vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createRepairBooking: vi.fn(),
  createRepairPickupReceiverClient: vi.fn(),
  ensureActionRateLimit: vi.fn(),
  getRepairCenterAddress: vi.fn(),
  initializeTransaction: vi.fn(),
  bindRepairPickupPendingPaymentReference: vi.fn(),
  markRepairPickupAwaitingPayment: vi.fn(),
  quoteRepairPickup: vi.fn(),
  resolveRepairPickupPaymentMerchant: vi.fn(),
  rpc: vi.fn(),
}));

function createSupabaseMock() {
  return { rpc: mocks.rpc };
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));
vi.mock('@/lib/repairs/resolve-repair-pickup-payment-merchant', () => ({
  resolveRepairPickupPaymentMerchant: mocks.resolveRepairPickupPaymentMerchant,
}));
vi.mock('@/lib/ensure-action-rate-limit', () => ({
  ensureActionRateLimit: mocks.ensureActionRateLimit,
}));
vi.mock('@/lib/repairs/create-repair-core', () => ({
  createRepairBooking: mocks.createRepairBooking,
}));
vi.mock('@/lib/repairs/bind-repair-pickup-pending-payment-reference', () => ({
  bindRepairPickupPendingPaymentReference:
    mocks.bindRepairPickupPendingPaymentReference,
}));
vi.mock('@/lib/repairs/mark-repair-pickup-awaiting-payment', () => ({
  markRepairPickupAwaitingPayment: mocks.markRepairPickupAwaitingPayment,
}));
vi.mock('@/lib/repairs/quote-repair-pickup', () => ({
  quoteRepairPickup: mocks.quoteRepairPickup,
}));
vi.mock('@/lib/repairs/repair-center-address', () => ({
  getRepairCenterAddress: mocks.getRepairCenterAddress,
}));
vi.mock('@/lib/repairs/repair-pickup-receiver-client', () => ({
  createRepairPickupReceiverClient: mocks.createRepairPickupReceiverClient,
}));
vi.mock('@/lib/paystack', () => ({
  initializeTransaction: mocks.initializeTransaction,
}));

export const startRepairPickupPaymentMerchantId =
  '123e4567-e89b-12d3-a456-426614174000';
export const startRepairPickupPaymentRepairId =
  '223e4567-e89b-12d3-a456-426614174000';

export const startRepairPickupPaymentInput = {
  customerEmail: 'ada@example.com',
  customerName: 'Ada Lovelace',
  customerPhone: '+2348012345678',
  deviceModel: 'iPhone 15',
  deviceType: 'Smartphone' as const,
  issueDescription: 'The screen no longer responds to touch.',
  pickupAddress: '12 Station Road, Osogbo, Osun, Nigeria',
  preferredDate: '2026-09-10T09:00',
  serviceType: 'pickup' as const,
};

export const startRepairPickupPaymentCenter = {
  address: '2 Olaide Tomori Street, Ikeja',
  city: 'Ikeja',
  country: 'Nigeria',
  countryCode: 'NG',
  email: 'repairs@example.com',
  name: 'Repair Centre',
  phone: '+2348011111111',
  state: 'Lagos',
};

export const startRepairPickupPaymentQuote = {
  carrierName: 'GIG Logistics',
  currency: 'NGN',
  estimatedDays: 3,
  expiresAt: new Date('2026-09-02T12:00:00.000Z'),
  price: 8250,
  provider: 'GIGL',
  providerRateId: 'gigl-rate',
  serviceTier: 'GoStandard',
};

/** Shared happy-path arrange for startRepairPickupPayment suites. */
export function arrangeStartRepairPickupPayment() {
  vi.clearAllMocks();
  process.env.PAYSTACK_SECRET_KEY = 'paystack-secret-for-tests';
  process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'usebaci.com';
  mocks.ensureActionRateLimit.mockResolvedValue(true);
  mocks.rpc.mockResolvedValue({
    data: null,
    error: null,
  });
  mocks.createClient.mockResolvedValue({});
  mocks.createRepairPickupReceiverClient.mockReturnValue(createSupabaseMock());
  mocks.resolveRepairPickupPaymentMerchant.mockResolvedValue({
    id: startRepairPickupPaymentMerchantId,
    slug: 'ogabassey',
  });
  mocks.getRepairCenterAddress.mockResolvedValue(
    startRepairPickupPaymentCenter
  );
  mocks.quoteRepairPickup.mockResolvedValue({
    quote: startRepairPickupPaymentQuote,
    request: {
      items: [],
      receiver: startRepairPickupPaymentCenter,
      sender: {},
    },
  });
  mocks.createRepairBooking.mockResolvedValue({
    success: true,
    id: startRepairPickupPaymentRepairId,
    ticketNumber: 42,
  });
  mocks.markRepairPickupAwaitingPayment.mockResolvedValue({ ok: true });
  mocks.bindRepairPickupPendingPaymentReference.mockResolvedValue({ ok: true });
  mocks.initializeTransaction.mockResolvedValue({
    access_code: 'access-code',
    authorization_url: 'https://checkout.paystack.com/access-code',
    reference: 'provider-reference',
  });
}

export function getStartRepairPickupPaymentMocks(): typeof mocks {
  return mocks;
}
