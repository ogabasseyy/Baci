import { jest } from '@jest/globals';
import type { RepairBookingRequest } from '@/lib/repair-catalog-schemas';
import type { RepairPickupSession } from '@/schemas/repair-pickup';

// Shared harness for the two colocated checkout-hook suites (payment +
// recovery). Kept in a `.test-utils` file — ignored by jest's
// testPathIgnorePatterns and outside Metro's `.test.` blocklist — so both
// suites share the mock fns/fixtures and stay under the 300-line file limit.
// The `jest.mock(...)` module registrations stay in each test file so
// babel-plugin-jest-hoist lifts them above every import (including the hooks
// under test); registering them here would run too late, after the hooks
// have already bound the real modules.

type AsyncMockFn = (...args: unknown[]) => Promise<unknown>;

export const mockClientQuote = jest.fn<AsyncMockFn>();
export const mockClientPay = jest.fn<AsyncMockFn>();
export const mockClientStatus = jest.fn<AsyncMockFn>();
export const mockSessionLoad = jest.fn<AsyncMockFn>();
export const mockSessionSave = jest.fn<AsyncMockFn>();
export const mockSessionClear = jest.fn<AsyncMockFn>();
export const mockOpenPayment = jest.fn<AsyncMockFn>();

export const pickupRequestFixture: RepairBookingRequest = {
  customerName: 'Ada Lovelace',
  customerEmail: 'ada@example.com',
  customerPhone: '08012345678',
  deviceType: 'Smartphone',
  deviceModel: 'iPhone 13',
  issueDescription: 'Cracked screen needs replacement.',
  serviceType: 'pickup',
  pickupAddress: '14 Allen Avenue, Ikeja, Lagos',
};

export const pickupSessionFixture: RepairPickupSession = {
  resumeToken: 'resume-token',
  ticketNumber: 42,
  price: 8250,
  paymentUrl: 'https://checkout.paystack.com/test',
};

export function readyRecovery(saved: RepairPickupSession | null) {
  return { ready: true, saved };
}

export function pickupStatusFound(
  overrides: Record<string, unknown> = {}
): unknown {
  return {
    found: true,
    repair: {
      status: 'pending',
      trackingNumber: null,
      pickupPaymentStatus: 'awaiting_payment',
      ticketNumber: 42,
      ...overrides,
    },
  };
}

export function pickupStatusNotFound(): unknown {
  return { found: false };
}

export function pickupPaySuccess(
  overrides: Record<string, unknown> = {}
): unknown {
  return {
    success: true,
    ticketNumber: 42,
    resumeToken: 'resume-token',
    payment: {
      amount: 8250,
      authorizationUrl: 'https://checkout.paystack.com/test',
      reference: 'RPU-123',
    },
    ...overrides,
  };
}

export function pickupPayFailure(
  overrides: Record<string, unknown> = {}
): unknown {
  return {
    success: false,
    error: 'Payment could not start.',
    code: 'payment_initialization_failed',
    ...overrides,
  };
}

// Re-seed the checkout mocks to their idle baseline. `clearAllMocks` does
// not drain queued `mockResolvedValueOnce` values, so every mock is reset
// before re-seeding to stop a queued Once from a prior test leaking in.
export function primeRepairPickupCheckoutMocks() {
  mockClientQuote.mockReset();
  mockClientPay.mockReset();
  mockClientStatus.mockReset();
  mockSessionLoad.mockReset();
  mockSessionSave.mockReset();
  mockSessionClear.mockReset();
  mockOpenPayment.mockReset();
  mockSessionLoad.mockResolvedValue(null);
  mockSessionSave.mockResolvedValue(undefined);
  mockSessionClear.mockResolvedValue(undefined);
  mockOpenPayment.mockResolvedValue(undefined);
  mockClientQuote.mockResolvedValue({ price: 8250, currency: 'NGN' });
}
