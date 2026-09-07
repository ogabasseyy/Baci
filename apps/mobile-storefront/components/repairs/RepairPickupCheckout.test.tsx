import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import { repairPickupClient } from '@/lib/repair-pickup-client';
import { repairPickupSession } from '@/lib/repair-pickup-session';
import { RepairPickupCheckout } from './RepairPickupCheckout';

jest.mock('@/lib/repair-pickup-session', () => ({
  repairPickupSession: {
    load: jest.fn(),
    save: jest.fn(),
  },
}));

jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
jest.mock('@/lib/repair-pickup-client', () => ({
  repairPickupClient: {
    quote: jest.fn(),
    pay: jest.fn(),
    status: jest.fn(),
  },
}));
const data = {
  customerName: 'Test Customer',
  customerEmail: 'test@example.com',
  customerPhone: '08012345678',
  deviceType: 'Smartphone' as const,
  deviceModel: 'iPhone 13',
  issueDescription: 'The screen is broken',
  serviceType: 'pickup' as const,
  pickupAddress: '10 Test Street, Osogbo, Osun',
};
const payment = {
  success: true as const,
  ticketNumber: 123,
  resumeToken: 'resume',
  payment: {
    amount: 3000,
    reference: 'ref',
    authorizationUrl: 'https://checkout.paystack.com/test',
  },
};

describe('RepairPickupCheckout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(repairPickupSession.load).mockResolvedValue(null);
    jest.mocked(repairPickupSession.save).mockResolvedValue(undefined);
    jest
      .mocked(repairPickupClient.quote)
      .mockResolvedValue({ price: 3000, currency: 'NGN' });
    jest.mocked(repairPickupClient.pay).mockResolvedValue(payment);
    jest.mocked(repairPickupClient.status).mockResolvedValue({
      found: true,
      repair: {
        status: 'pending',
        ticketNumber: 123,
        trackingNumber: null,
        pickupPaymentStatus: 'awaiting_payment',
      },
    });
  });
  async function quote() {
    render(<RepairPickupCheckout data={data} onBack={jest.fn()} />);
    await waitFor(() =>
      expect(screen.queryByLabelText('Loading pickup')).toBeNull()
    );
    fireEvent.press(screen.getByRole('button', { name: 'Get pickup fee' }));
    await screen.findByText('Pickup fee: NGN 3,000');
  }
  it('requires an explicit payment action after showing the price', async () => {
    await quote();
    expect(repairPickupClient.pay).not.toHaveBeenCalled();
  });
  it('does not claim booking after browser dismissal and reuses the existing payment link', async () => {
    await quote();
    fireEvent.press(screen.getByRole('button', { name: 'Pay pickup fee' }));
    await screen.findByText('Awaiting payment confirmation.');
    await waitFor(() =>
      expect(screen.queryByLabelText('Loading pickup')).toBeNull()
    );
    fireEvent.press(screen.getByRole('button', { name: 'Continue payment' }));
    await waitFor(() =>
      expect(WebBrowser.openBrowserAsync).toHaveBeenCalledTimes(2)
    );
    expect(repairPickupClient.pay).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Pickup booked/)).toBeNull();
  });
  it('shows the server-confirmed waybill and stops offering payment', async () => {
    jest.mocked(repairPickupClient.status).mockResolvedValue({
      found: true,
      repair: {
        status: 'pending',
        ticketNumber: 123,
        trackingNumber: '1349612345',
        pickupPaymentStatus: 'booked',
      },
    });
    await quote();
    fireEvent.press(screen.getByRole('button', { name: 'Pay pickup fee' }));
    await screen.findByText('Pickup booked. Waybill: 1349612345');
    expect(
      screen.queryByRole('button', { name: 'Continue payment' })
    ).toBeNull();
  });
  it('keeps failed payment initialization resumable on the same ticket', async () => {
    jest.mocked(repairPickupClient.pay).mockResolvedValueOnce({
      success: false,
      error: 'Retry payment',
      code: 'payment_initialization_failed',
      resumeToken: 'resume',
    });
    await quote();
    fireEvent.press(screen.getByRole('button', { name: 'Pay pickup fee' }));
    await screen.findByText('Retry payment');
    fireEvent.press(screen.getByRole('button', { name: 'Pay pickup fee' }));
    await waitFor(() =>
      expect(repairPickupClient.pay).toHaveBeenLastCalledWith(
        data,
        3000,
        'resume'
      )
    );
  });
  it('requires successful recovery after a storage failure before allowing a quote', async () => {
    jest
      .mocked(repairPickupSession.load)
      .mockRejectedValueOnce(new Error('Storage unavailable'));
    render(<RepairPickupCheckout data={data} onBack={jest.fn()} />);
    await screen.findByText(
      'Could not restore pickup payment. Retry recovery before paying.'
    );
    expect(screen.queryByLabelText('Loading pickup')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Get pickup fee' }));
    expect(repairPickupClient.quote).not.toHaveBeenCalled();
    fireEvent.press(
      screen.getByRole('button', { name: 'Retry payment recovery' })
    );
    await waitFor(() =>
      expect(screen.queryByLabelText('Loading pickup')).toBeNull()
    );
    fireEvent.press(screen.getByRole('button', { name: 'Get pickup fee' }));
    await screen.findByText('Pickup fee: NGN 3,000');
  });
  it('requires another explicit payment action after a price change', async () => {
    jest.mocked(repairPickupClient.pay).mockResolvedValueOnce({
      success: false,
      code: 'quote_changed',
      error: 'Price changed',
      quote: { price: 3500 },
    });
    await quote();
    fireEvent.press(screen.getByRole('button', { name: 'Pay pickup fee' }));
    await screen.findByText('Pickup fee: NGN 3,500');
    expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
    expect(repairPickupClient.pay).toHaveBeenCalledTimes(1);
  });
  it('restores an existing payment and checks it before opening the browser', async () => {
    jest.mocked(repairPickupSession.load).mockResolvedValueOnce({
      price: 3000,
      resumeToken: 'resume',
      ticketNumber: 123,
      paymentUrl: payment.payment.authorizationUrl,
    });
    jest.mocked(repairPickupClient.status).mockResolvedValueOnce({
      found: true,
      repair: {
        ticketNumber: 123,
        status: 'pending',
        trackingNumber: null,
        pickupPaymentStatus: 'booking',
      },
    });
    render(<RepairPickupCheckout data={data} onBack={jest.fn()} />);
    await screen.findByText('Repair ticket: 123');
    fireEvent.press(screen.getByRole('button', { name: 'Continue payment' }));
    await screen.findByText(
      'Payment received. Pickup confirmation is pending.'
    );
    expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
    expect(repairPickupClient.pay).not.toHaveBeenCalled();
  });
  it('rejects an unexpected payment host', async () => {
    jest.mocked(repairPickupClient.pay).mockResolvedValueOnce({
      ...payment,
      payment: {
        ...payment.payment,
        authorizationUrl: 'https://example.com',
      },
    });
    await quote();
    fireEvent.press(screen.getByRole('button', { name: 'Pay pickup fee' }));
    await screen.findByText(
      'Invalid payment link. Contact support with your ticket.'
    );
    expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
  });
  it('allows returning to drop-off after a quote failure', async () => {
    const back = jest.fn();
    jest
      .mocked(repairPickupClient.quote)
      .mockRejectedValue(new Error('No pickup coverage'));
    render(<RepairPickupCheckout data={data} onBack={back} />);
    await waitFor(() =>
      expect(screen.queryByLabelText('Loading pickup')).toBeNull()
    );
    fireEvent.press(screen.getByRole('button', { name: 'Get pickup fee' }));
    await screen.findByText('No pickup coverage');
    fireEvent.press(
      screen.getByRole('button', { name: 'Edit details or choose drop-off' })
    );
    expect(back).toHaveBeenCalledTimes(1);
  });
});
