import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { RepairPickupSession } from '@/schemas/repair-pickup';
import {
  mockClientPay,
  mockClientQuote,
  mockClientStatus,
  mockOpenPayment,
  mockSessionClear,
  mockSessionLoad,
  mockSessionSave,
  pickupPayFailure,
  pickupPaySuccess,
  pickupRequestFixture,
  pickupSessionFixture,
  pickupStatusFound,
  pickupStatusNotFound,
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

describe('useRepairPickupCheckoutPayment recovery', () => {
  beforeEach(() => {
    primeRepairPickupCheckoutMocks();
    resetAppStateListeners();
  });

  it('clears stale recovery when the resume token expired', async () => {
    mockClientPay.mockResolvedValueOnce(
      pickupPayFailure({
        code: 'resume_invalid',
        error: 'Session expired. Start again.',
        resumeToken: 'stale-token',
        ticketNumber: 7,
        quote: { price: 9000 },
      })
    );
    const { result } = renderPayment();
    await act(async () => {
      await result.current.quote();
    });
    let thrown: unknown;
    await act(async () => {
      thrown = await result.current.pay().catch((error: unknown) => error);
    });
    expect((thrown as Error).message).toBe('Session expired. Start again.');
    expect(mockSessionClear).toHaveBeenCalledWith(pickupRequestFixture);
    expect(result.current.ticket).toBe(7);
    expect(result.current.price).toBe(9000);
  });

  it('retries tokenless after clearing stale recovery', async () => {
    mockClientPay.mockResolvedValueOnce(
      pickupPayFailure({
        code: 'resume_invalid',
        error: 'Session expired.',
        resumeToken: 'stale-token',
      })
    );
    mockClientStatus.mockResolvedValue(pickupStatusFound());
    mockClientPay.mockResolvedValueOnce(
      pickupPaySuccess({
        payment: {
          amount: 8250,
          authorizationUrl: 'https://checkout.paystack.com/fresh',
          reference: 'RPU-2',
        },
      })
    );
    const { result } = renderPayment();
    await act(async () => {
      await result.current.quote();
    });
    await act(async () => {
      await result.current.pay().catch(() => undefined);
    });
    await act(async () => {
      await result.current.run(result.current.pay);
    });
    expect(mockClientPay).toHaveBeenLastCalledWith(
      pickupRequestFixture,
      8250,
      undefined
    );
    expect(mockOpenPayment).toHaveBeenCalledWith(
      'https://checkout.paystack.com/fresh'
    );
  });

  it('stops before paying again when the repair is terminal', async () => {
    mockClientStatus.mockResolvedValueOnce(
      pickupStatusFound({ status: 'completed' })
    );
    const { result } = renderPayment(pickupSessionFixture);
    await waitFor(() => expect(result.current.ticket).toBe(42));
    await act(async () => {
      await result.current.run(result.current.pay);
    });
    expect(result.current.terminal).toBe(true);
    expect(mockClientPay).not.toHaveBeenCalled();
  });

  it('warns instead of opening checkout when the recovered amount changed', async () => {
    mockClientPay.mockResolvedValueOnce(
      pickupPaySuccess({
        payment: {
          amount: 9000,
          authorizationUrl: 'https://checkout.paystack.com/changed',
          reference: 'RPU-9',
        },
      })
    );
    const { result } = renderPayment();
    await act(async () => {
      await result.current.quote();
    });
    await act(async () => {
      await result.current.run(result.current.pay);
    });
    expect(mockOpenPayment).not.toHaveBeenCalled();
    expect(result.current.warning).toMatch('earlier payment');
  });

  it('holds the busy guard for one action at a time', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockClientQuote.mockReturnValueOnce(
      gate.then(() => ({ price: 8250, currency: 'NGN' }))
    );
    const { result } = renderPayment();
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.run(result.current.quote);
      second = result.current.run(result.current.quote);
    });
    expect(result.current.busy).toBe(true);
    await act(async () => {
      release();
      await first;
      await second;
    });
    expect(result.current.busy).toBe(false);
    expect(mockClientQuote).toHaveBeenCalledTimes(1);
    expect(result.current.price).toBe(8250);
  });

  it('startAnother clears recovery and returns', async () => {
    const onBack = jest.fn();
    const { result } = renderPayment();
    await act(async () => {
      await result.current.startAnother(onBack);
    });
    expect(mockSessionClear).toHaveBeenCalledWith(pickupRequestFixture);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('refresh surfaces an unavailable status', async () => {
    mockClientStatus.mockResolvedValueOnce(pickupStatusNotFound());
    const { result } = renderPayment();
    let thrown: unknown;
    await act(async () => {
      thrown = await result.current
        .refresh(42)
        .catch((error: unknown) => error);
    });
    expect((thrown as Error).message).toMatch('Status unavailable');
  });
});
