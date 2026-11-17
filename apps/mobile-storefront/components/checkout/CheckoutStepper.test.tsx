import { fireEvent, render, screen } from '@testing-library/react-native';
import { CheckoutStepper } from './CheckoutStepper';

const mockColors = {
  card: '#ffffff',
  text: '#111827',
  textSecondary: '#6b7280',
  border: '#e5e7eb',
  background: '#f9fafb',
} as Parameters<typeof CheckoutStepper>[0]['colors'];

const baseProps = {
  colors: mockColors,
  isDark: false,
  itemCount: 2,
  setStep: jest.fn(),
};

describe('CheckoutStepper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows "Step 1 of 3" when on the address step', () => {
    render(<CheckoutStepper {...baseProps} step="address" />);
    expect(screen.getByText('Step 1 of 3')).toBeTruthy();
  });

  it('shows "Step 2 of 3" when on the payment step', () => {
    render(<CheckoutStepper {...baseProps} step="payment" />);
    expect(screen.getByText('Step 2 of 3')).toBeTruthy();
  });

  it('shows "Step 3 of 3" when on the review step', () => {
    render(<CheckoutStepper {...baseProps} step="review" />);
    expect(screen.getByText('Step 3 of 3')).toBeTruthy();
  });

  it('shows the item count in the badge', () => {
    render(<CheckoutStepper {...baseProps} step="address" itemCount={3} />);
    expect(screen.getByText('3 items')).toBeTruthy();
  });

  it('uses singular "item" for a count of 1', () => {
    render(<CheckoutStepper {...baseProps} step="address" itemCount={1} />);
    expect(screen.getByText('1 item')).toBeTruthy();
  });

  it('calls setStep when pressing a completed pill', () => {
    render(<CheckoutStepper {...baseProps} step="payment" />);
    fireEvent.press(
      screen.getByRole('button', { name: /go to delivery step/i })
    );
    expect(baseProps.setStep).toHaveBeenCalledWith('address');
  });

  it('renders the current step as a non-interactive label', () => {
    render(<CheckoutStepper {...baseProps} step="address" />);
    expect(
      screen.queryByRole('button', { name: /go to delivery step/i })
    ).toBeNull();
    expect(screen.getByLabelText('Delivery step, current')).toBeTruthy();
  });

  it('marks upcoming steps as not yet available instead of dead buttons', () => {
    render(<CheckoutStepper {...baseProps} step="address" />);

    expect(screen.queryAllByRole('button')).toHaveLength(0);
    const payment = screen.getByLabelText('Payment step, not yet available');
    const review = screen.getByLabelText('Review step, not yet available');
    expect(payment).toHaveStyle({ borderStyle: 'dashed' });
    expect(review).toHaveStyle({ borderStyle: 'dashed' });
    fireEvent.press(payment);
    expect(baseProps.setStep).not.toHaveBeenCalled();
  });

  it('only lets completed steps navigate back', () => {
    render(<CheckoutStepper {...baseProps} step="review" />);
    expect(screen.getAllByRole('button')).toHaveLength(2);
    fireEvent.press(
      screen.getByRole('button', { name: /go to payment step/i })
    );
    expect(baseProps.setStep).toHaveBeenCalledWith('payment');
  });

  it('hides payment and uses a two-step flow for prize simulation', () => {
    render(<CheckoutStepper {...baseProps} isPrizeSimulation step="review" />);

    expect(screen.getByText('Step 2 of 2')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: /go to payment step/i })
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: /go to delivery step/i })
    ).toBeTruthy();
    expect(screen.getByLabelText('Review step, current')).toBeTruthy();
  });
});
