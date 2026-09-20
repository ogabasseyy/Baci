import { Alert } from 'react-native';
import { attachRedvaultGuestOrderAfterSignup } from './attach-redvault-guest-order';
import { runCheckoutPostOrderSideEffects } from './checkout-post-order-side-effects';
import {
  resolveCheckoutSubmitFence,
  runRedvaultSubmitInitializationSideEffects,
} from './checkout-submit-redvault';
import {
  resolveCheckoutRedvaultFence,
  routeToPaidFenceOrder,
} from './resolve-checkout-redvault-fence';
import { resolveRedvaultFenceForResubmit } from './resolve-redvault-resubmit-fence';

jest.mock('react-native', () => ({ Alert: { alert: jest.fn() } }));
jest.mock('./attach-redvault-guest-order', () => ({
  attachRedvaultGuestOrderAfterSignup: jest.fn(),
}));
jest.mock('./checkout-post-order-side-effects', () => ({
  runCheckoutPostOrderSideEffects: jest.fn(),
}));
jest.mock('./resolve-checkout-redvault-fence', () => ({
  resolveCheckoutRedvaultFence: jest.fn(),
  routeToPaidFenceOrder: jest.fn(),
}));
jest.mock('./resolve-redvault-resubmit-fence', () => ({
  resolveRedvaultFenceForResubmit: jest.fn(),
}));

const mockAlert = Alert.alert as jest.Mock;
const mockAttach = attachRedvaultGuestOrderAfterSignup as jest.Mock;
const mockSideEffects = runCheckoutPostOrderSideEffects as jest.Mock;
const mockResolveFence = resolveCheckoutRedvaultFence as jest.Mock;
const mockRoutePaid = routeToPaidFenceOrder as jest.Mock;
const mockResolveResubmit = resolveRedvaultFenceForResubmit as jest.Mock;

const address = {
  email: 'ada@example.com',
  phone: '0801',
  firstName: 'Ada',
  lastName: 'Lovelace',
} as never;

function fenceInput(overrides: Record<string, unknown> = {}) {
  return {
    accountPassword: '',
    address,
    clearCart: jest.fn(),
    customer: null,
    isAuthenticated: false,
    saveAsDefaultAddress: false,
    saveDetails: false,
    selectedPayment: 'card',
    selectedSavedAddressId: null,
    ...overrides,
  } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockResolveFence.mockResolvedValue({ proceed: true });
  mockResolveResubmit.mockResolvedValue('proceed');
});

describe('resolveCheckoutSubmitFence', () => {
  it('alerts and stops when the REDVAULT review is unavailable', async () => {
    const result = await resolveCheckoutSubmitFence(
      fenceInput({ selectedPayment: 'uba_redvault' })
    );

    expect(result.proceed).toBe(false);
    expect(mockAlert).toHaveBeenCalledWith(
      'Unable to continue',
      expect.stringContaining('UBA payment review is unavailable')
    );
    expect(mockResolveFence).not.toHaveBeenCalled();
    expect(mockResolveResubmit).not.toHaveBeenCalled();
  });

  it('derives the customer identity from the signed-in customer first', async () => {
    const result = await resolveCheckoutSubmitFence(
      fenceInput({
        customer: { email: 'signed@example.com', id: 'cust-1' },
      })
    );

    expect(result).toEqual({
      proceed: true,
      customerEmail: 'signed@example.com',
      customerName: 'Ada Lovelace',
      customerPhone: '0801',
    });
  });

  it('routes a paid fence instead of submitting another method', async () => {
    const clearCart = jest.fn();
    mockResolveFence.mockResolvedValue({
      proceed: true,
      paidOrderId: 'order-paid',
      paidOrderNumber: 'RV-9',
      paidTrackingToken: 'track-paid',
    });

    const result = await resolveCheckoutSubmitFence(
      fenceInput({ clearCart, selectedPayment: 'card' })
    );

    expect(result.proceed).toBe(false);
    expect(mockRoutePaid).toHaveBeenCalledWith({
      clearCart,
      orderId: 'order-paid',
      orderNumber: 'RV-9',
      trackingToken: 'track-paid',
    });
  });

  it('stops when the non-REDVAULT fence does not proceed', async () => {
    mockResolveFence.mockResolvedValue({ proceed: false });

    const result = await resolveCheckoutSubmitFence(
      fenceInput({ selectedPayment: 'card' })
    );

    expect(result.proceed).toBe(false);
    expect(mockRoutePaid).not.toHaveBeenCalled();
  });

  it('resolves the resubmit fence for REDVAULT submits', async () => {
    const onRedvaultOrder = jest.fn();
    mockResolveResubmit.mockResolvedValue('held');

    const result = await resolveCheckoutSubmitFence(
      fenceInput({ selectedPayment: 'uba_redvault', onRedvaultOrder })
    );

    expect(result.proceed).toBe(false);
    expect(mockResolveResubmit).toHaveBeenCalledWith(
      expect.objectContaining({ attemptGuestAttach: false })
    );
    expect(mockResolveFence).not.toHaveBeenCalled();
  });

  it('attempts guest attach when save-details qualifies', async () => {
    await resolveCheckoutSubmitFence(
      fenceInput({
        accountPassword: 'secret1',
        isAuthenticated: false,
        saveDetails: true,
        selectedPayment: 'uba_redvault',
        onRedvaultOrder: jest.fn(),
      })
    );

    expect(mockResolveResubmit).toHaveBeenCalledWith(
      expect.objectContaining({ attemptGuestAttach: true })
    );
  });
});

describe('runRedvaultSubmitInitializationSideEffects', () => {
  const sideEffectsInput = {
    accountPassword: '',
    address,
    customerEmail: 'ada@example.com',
    customerId: undefined,
    isAuthenticated: true,
    orderId: 'order-rv',
    saveAsDefaultAddress: false,
    saveDetails: false,
    selectedSavedAddressId: null,
  } as Parameters<typeof runRedvaultSubmitInitializationSideEffects>[0];

  it('runs post-order side effects without attach for authenticated shoppers', async () => {
    await runRedvaultSubmitInitializationSideEffects(sideEffectsInput);

    expect(mockSideEffects).toHaveBeenCalledTimes(1);
    expect(mockAttach).not.toHaveBeenCalled();
  });

  it('attaches the guest order after a qualifying guest signup', async () => {
    await runRedvaultSubmitInitializationSideEffects({
      ...sideEffectsInput,
      accountPassword: 'secret1',
      isAuthenticated: false,
      saveDetails: true,
    });

    expect(mockSideEffects).toHaveBeenCalledTimes(1);
    expect(mockAttach).toHaveBeenCalledWith({ orderId: 'order-rv' });
  });
});
