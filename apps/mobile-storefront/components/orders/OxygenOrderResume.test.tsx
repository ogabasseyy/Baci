import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { getOxygenStagingProfile } from '@/lib/oxygen-staging-profile';
import { OxygenOrderResume } from './OxygenOrderResume';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/lib/oxygen-staging-profile', () => ({
  getOxygenStagingProfile: jest.fn(),
}));
describe('owned Oxygen history resume', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .mocked(getOxygenStagingProfile)
      .mockReturnValue({} as ReturnType<typeof getOxygenStagingProfile>);
  });
  const order = {
    id: 'aebdc237-5363-4e2b-b0ee-5be12ea9edab',
    payment_method: 'oxygen',
    payment_status: 'pending',
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
