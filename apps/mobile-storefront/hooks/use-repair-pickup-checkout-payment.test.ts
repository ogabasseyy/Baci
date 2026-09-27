import { beforeEach, describe, expect, it } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import type { RepairPickupSession } from '@/schemas/repair-pickup';
import {
  mockClientPay,
  mockClientQuote,
  mockClientStatus,
  mockOpenPayment,
  mockSessionClear,
  mockSessionLoad,
  mockSessionSave,
  pickupPaySuccess,
  pickupRequestFixture,
  pickupSessionFixture,
  pickupStatusFound,
  primeRepairPickupCheckoutMocks,
  readyRecovery,
} from './use-repair-pickup-checkout.test-utils';
import { useRepairPickupCheckoutPayment } from './use-repair-pickup-checkout-payment';

// jest.mock is hoisted above every import, so the hook under test binds to
// these mocks rather than the real network/storage/browser modules. The
// factories reference the imported `mock*` singletons (allowed by
// babel-plugin-jest-hoist) and only invoke them at call time, once the
// test-utils bindings have initialized.
jest.mock('@/lib/repair-pickup-client', () => ({
  repairPickupClient: {
    pay: (...args: unknown[]) => mockClientPay(...args),
    quote: (...args: unknown[]) => mockClientQuote(...args),
    status: (...args: unknown[]) => mockClientStatus(...args),
  },
}));

jest.mock('@/lib/repair-pickup-session', () => ({
  repairPickupSession: {
    clear: (...args: unknown[]) => mockSessionClear(...args),
    load: (...args: unknown[]) => mockSessionLoad(...args),
    save: (...args: unknown[]) => mockSessionSave(...args),
  },
}));

jest.mock('@/lib/open-repair-pickup-payment', () => ({
  openRepairPickupPayment: (...args: unknown[]) => mockOpenPayment(...args),
}));

type AppStateListener = (state: string) => void;
// `mock` prefix: babel-plugin-jest-hoist allows these inside jest.mock.
const mockAppStateListeners = new Set<AppStateListener>();
function emitAppState(state: string) {
  for (const listener of [...mockAppStateListeners]) listener(state);
}
function resetAppStateListeners() {
  mockAppStateListeners.clear();
}
// No requireActual spread: enumerating the real module triggers native
// TurboModules absent under jest. Nothing else in this graph needs RN.
jest.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: (_event: string, handler: AppStateListener) => {
      mockAppStateListeners.add(handler);
      return { remove: () => mockAppStateListeners.delete(handler) };
    },
  },
}));

type Recovery = { ready: boolean; saved: RepairPickupSession | null };

function renderPayment(saved: RepairPickupSession | null = null) {
  return renderHook(
    (recovery: Recovery) =>
      useRepairPickupCheckoutPayment(pickupRequestFixture, recovery),
    { initialProps: readyRecovery(saved) }
  );
}

describe('useRepairPickupCheckoutPayment', () => {
  beforeEach(() => {
    primeRepairPickupCheckoutMocks();
    resetAppStateListeners();
  });

  it('starts idle with no price, ticket, or error', () => {
    const { result } = renderPayment();
    expect(result.current.price).toBeNull();
    expect(result.current.ticket).toBeNull();
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toBeUndefined();
  });

  it('adopts the recovered session into state', () => {
    const { result, rerender } = renderPayment();
    rerender(readyRecovery(pickupSessionFixture));
    expect(result.current.ticket).toBe(42);
    expect(result.current.price).toBe(8250);
    expect(result.current.paymentUrl).toBe(
      'https://checkout.paystack.com/test'
    );
  });

  it('quotes the pickup fee', async () => {
    const { result } = renderPayment();
    await act(async () => {
      await result.current.quote();
    });
    expect(result.current.price).toBe(8250);
    expect(mockClientQuote).toHaveBeenCalledWith(pickupRequestFixture);
  });

  it('surfaces quote failures as errors', async () => {
    mockClientQuote.mockRejectedValueOnce(new Error('GIGL offline'));
    const { result } = renderPayment();
    await act(async () => {
      await result.current.run(result.current.quote);
    });
    expect(result.current.error).toBe('GIGL offline');
    expect(result.current.price).toBeNull();
    expect(result.current.busy).toBe(false);
  });

  it('reports unknown failures with a fallback message', async () => {
    mockClientQuote.mockRejectedValueOnce('boom');
    const { result } = renderPayment();
    await act(async () => {
      await result.current.run(result.current.quote);
    });
    expect(result.current.error).toBe('Please try again.');
  });

  it('pays, saves recovery, opens checkout, and refreshes status', async () => {
    mockClientPay.mockResolvedValueOnce(pickupPaySuccess());
    mockClientStatus.mockResolvedValueOnce(
      pickupStatusFound({
        pickupPaymentStatus: 'paid',
        trackingNumber: 'GIG123',
      })
    );
    const { result } = renderPayment();
    await act(async () => {
      await result.current.quote();
    });
    await act(async () => {
      await result.current.run(result.current.pay);
    });
    expect(mockClientPay).toHaveBeenCalledWith(
      pickupRequestFixture,
      8250,
      undefined
    );
    expect(mockSessionSave).toHaveBeenCalledWith(pickupRequestFixture, {
      resumeToken: 'resume-token',
      ticketNumber: 42,
      price: 8250,
      paymentUrl: 'https://checkout.paystack.com/test',
    });
    expect(mockOpenPayment).toHaveBeenCalledWith(
      'https://checkout.paystack.com/test'
    );
    expect(result.current.ticket).toBe(42);
    expect(result.current.status).toBe('paid');
    expect(result.current.tracking).toBe('GIG123');
  });

  it('refreshes status once when the app returns after the browser opened', async () => {
    mockClientPay.mockResolvedValueOnce(pickupPaySuccess());
    mockClientStatus.mockResolvedValue(pickupStatusFound());
    const { result } = renderPayment();
    await act(async () => {
      await result.current.quote();
    });
    await act(async () => {
      await result.current.run(result.current.pay);
    });
    // Inline refresh from pay().
    expect(mockClientStatus).toHaveBeenCalledTimes(1);
    await act(async () => {
      emitAppState('active');
    });
    expect(mockClientStatus).toHaveBeenCalledTimes(2);
    // One-shot: further foregroundings do not refetch.
    await act(async () => {
      emitAppState('active');
    });
    expect(mockClientStatus).toHaveBeenCalledTimes(2);
  });

  it('ignores app foregrounding when no browser was opened', async () => {
    mockClientStatus.mockResolvedValue(pickupStatusFound());
    const { result } = renderPayment();
    await act(async () => {
      await result.current.quote();
    });
    await act(async () => {
      emitAppState('active');
    });
    expect(mockClientStatus).not.toHaveBeenCalled();
    expect(result.current.status).toBeUndefined();
  });
});
