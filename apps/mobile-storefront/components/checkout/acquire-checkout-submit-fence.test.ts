import { acquireCheckoutSubmitFence } from './acquire-checkout-submit-fence';
import { resolveCheckoutSubmitFence } from './checkout-submit-redvault';

jest.mock('./checkout-submit-redvault', () => ({
  resolveCheckoutSubmitFence: jest.fn(),
}));

const mockResolveCheckoutSubmitFence = resolveCheckoutSubmitFence as jest.Mock;

function options(overrides = {}) {
  return {
    accountPassword: '',
    address: {
      email: 'ada@example.com',
      phone: '+2348012345678',
      firstName: 'Ada',
      lastName: 'Eze',
    },
    clearCart: jest.fn(),
    customer: { email: 'ada@example.com', id: 'customer-1' },
    isAuthenticated: false,
    isOrderInFlight: { current: false },
    saveAsDefaultAddress: false,
    saveDetails: false,
    selectedPayment: 'paystack',
    selectedSavedAddressId: null,
    ...overrides,
  };
}

describe('acquireCheckoutSubmitFence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('holds the latch while the fence resolves and returns the fence', async () => {
    let resolveFence: (value: object) => void = () => undefined;
    mockResolveCheckoutSubmitFence.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFence = resolve;
        })
    );
    const opts = options();

    const pending = acquireCheckoutSubmitFence(opts as never);
    expect(opts.isOrderInFlight.current).toBe(true);

    const fence = {
      proceed: true,
      customerEmail: 'ada@example.com',
      customerName: 'Ada Eze',
      customerPhone: '+2348012345678',
    };
    resolveFence(fence);

    await expect(pending).resolves.toBe(fence);
    expect(opts.isOrderInFlight.current).toBe(true);
  });

  it('releases the latch and returns null when the fence declines', async () => {
    mockResolveCheckoutSubmitFence.mockResolvedValue({
      proceed: false,
      customerEmail: 'ada@example.com',
      customerName: 'Ada Eze',
      customerPhone: '+2348012345678',
    });
    const opts = options();

    await expect(acquireCheckoutSubmitFence(opts as never)).resolves.toBe(null);
    expect(opts.isOrderInFlight.current).toBe(false);
  });

  it('releases the latch when the fence throws', async () => {
    mockResolveCheckoutSubmitFence.mockRejectedValue(new Error('boom'));
    const opts = options();

    await expect(acquireCheckoutSubmitFence(opts as never)).rejects.toThrow(
      'boom'
    );
    expect(opts.isOrderInFlight.current).toBe(false);
  });
});
