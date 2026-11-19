import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { getOxygenStagingProfile } from '@/lib/oxygen-staging-profile';
import { OxygenOrderResume } from './OxygenOrderResume';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/lib/oxygen-staging-profile', () => ({
  getOxygenStagingProfile: jest.fn(),
}));
const mockCustomer = {
  id: 'customer-1',
  user_id: 'user-1',
  merchant_id: 'merchant-1',
};
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (
    select: (state: {
      user: { id: string };
      customer: typeof mockCustomer;
    }) => unknown
  ) => select({ user: { id: 'user-1' }, customer: mockCustomer }),
}));

describe('owned Oxygen history resume', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .mocked(getOxygenStagingProfile)
      .mockReturnValue({ merchantId: 'merchant-1' } as ReturnType<
        typeof getOxygenStagingProfile
      >);
  });
  const order = {
    id: 'aebdc237-5363-4e2b-b0ee-5be12ea9edab',
    payment_method: 'oxygen',
    payment_status: 'unpaid',
    customer_id: mockCustomer.id,
    merchant_id: mockCustomer.merchant_id,
    shipping_status: 'pending',
  };
  it('routes only saved identity without initiating a new order or consulting new admission', () => {
    render(<OxygenOrderResume order={order} />);
    fireEvent.press(screen.getByText('Continue saved Oxygen checkout'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/oxygen-checkout',
      params: { orderId: order.id },
    });
  });
  it.each([
    { payment_status: 'paid' },
    { payment_status: 'bnpl_approved' },
    { payment_status: 'failed' },
    { payment_status: 'expired' },
    { customer_id: 'another-customer' },
    { merchant_id: 'another-merchant' },
    { id: 'malformed' },
    { shipping_status: 'cancelled' },
    { payment_method: 'credit_direct' },
  ])('does not rebook closed, activated or legacy orders %p', (patch) => {
    render(<OxygenOrderResume order={{ ...order, ...patch }} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('is hidden outside the staging app', () => {
    jest.mocked(getOxygenStagingProfile).mockReturnValue(null);
    render(<OxygenOrderResume order={order} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
