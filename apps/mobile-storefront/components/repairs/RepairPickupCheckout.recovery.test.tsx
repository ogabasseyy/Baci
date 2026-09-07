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

jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
jest.mock('@/lib/repair-pickup-client', () => ({
  repairPickupClient: { quote: jest.fn(), pay: jest.fn(), status: jest.fn() },
}));
jest.mock('@/lib/repair-pickup-session', () => ({
  repairPickupSession: { load: jest.fn(), save: jest.fn(), clear: jest.fn() },
}));
const data = {
  customerName: 'Test',
  customerEmail: 'test@example.com',
  customerPhone: '08012345678',
  deviceType: 'Smartphone' as const,
  deviceModel: 'iPhone',
  issueDescription: 'Broken screen',
  serviceType: 'pickup' as const,
  pickupAddress: '10 Test Road, Osogbo, Osun',
};
const result = {
  success: true as const,
  ticketNumber: 123,
  resumeToken: 'fresh',
  payment: {
    amount: 3000,
    reference: 'ref',
    authorizationUrl: 'https://checkout.paystack.com/test',
  },
};
describe('pickup recovery regressions', () => {
  it('shows the original recovered fee and requires confirmation before opening payment when quotes changed', async () => {
    jest.mocked(repairPickupClient.pay).mockResolvedValue({
      ...result,
      payment: { ...result.payment, amount: 3500 },
    });
    await show();
    fireEvent.press(screen.getByRole('button', { name: 'Pay pickup fee' }));
    await screen.findByText('Pickup fee: NGN 3,500');
    expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole('button', { name: 'Continue payment' }));
    await waitFor(() =>
      expect(WebBrowser.openBrowserAsync).toHaveBeenCalledTimes(1)
    );
    expect(repairPickupClient.pay).toHaveBeenCalledTimes(1);
  });
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(repairPickupSession.load).mockResolvedValue({
      price: 3000,
      ticketNumber: 123,
      resumeToken: 'expired',
    });
    jest.mocked(repairPickupSession.clear).mockResolvedValue(undefined);
    jest.mocked(repairPickupSession.save).mockResolvedValue(undefined);
    jest.mocked(repairPickupClient.pay).mockResolvedValue(result);
    jest.mocked(repairPickupClient.status).mockResolvedValue({
      found: true,
      repair: {
        ticketNumber: 123,
        status: 'pending',
        pickupPaymentStatus: 'awaiting_payment',
        trackingNumber: null,
      },
    });
  });
  async function show() {
    render(<RepairPickupCheckout data={data} onBack={jest.fn()} />);
    await screen.findByText('Repair ticket: 123');
  }
  it.each([
    false,
    true,
  ])('clears expired in-memory recovery even when storage cleanup fails: %s', async (cleanupFails) => {
    if (cleanupFails)
      jest
        .mocked(repairPickupSession.clear)
        .mockRejectedValue(new Error('Storage unavailable'));
    jest.mocked(repairPickupClient.pay).mockResolvedValueOnce({
      success: false,
      code: 'resume_invalid',
      error: 'Expired',
    });
    await show();
    fireEvent.press(screen.getByRole('button', { name: 'Pay pickup fee' }));
    await screen.findByText('Expired');
    if (cleanupFails)
      expect(
        screen.getByText(
          'Recovery storage could not be cleared. Keep this screen open.'
        )
      ).toBeTruthy();
    expect(repairPickupSession.clear).toHaveBeenCalledWith(data);
    fireEvent.press(screen.getByRole('button', { name: 'Pay pickup fee' }));
    await waitFor(() =>
      expect(repairPickupClient.pay).toHaveBeenLastCalledWith(
        data,
        3000,
        undefined
      )
    );
  });
  it('keeps and opens a valid payment URL when secure storage writes fail', async () => {
    jest
      .mocked(repairPickupSession.save)
      .mockRejectedValue(new Error('Storage full'));
    const navigationBackRef = { current: null as (() => void) | null };
    const back = jest.fn();
    render(
      <RepairPickupCheckout
        data={data}
        onBack={back}
        navigationBackRef={navigationBackRef}
      />
    );
    await screen.findByText('Repair ticket: 123');
    fireEvent.press(screen.getByRole('button', { name: 'Pay pickup fee' }));
    await waitFor(() =>
      expect(WebBrowser.openBrowserAsync).toHaveBeenCalledTimes(1)
    );
    await waitFor(() =>
      expect(screen.queryByLabelText('Loading pickup')).toBeNull()
    );
    navigationBackRef.current?.();
    expect(back).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole('button', { name: 'Continue payment' }));
    await waitFor(() =>
      expect(WebBrowser.openBrowserAsync).toHaveBeenCalledTimes(2)
    );
    expect(repairPickupClient.pay).toHaveBeenCalledTimes(1);
  });
  it.each([
    'completed',
    'cancelled',
    'rejected',
  ])('retires a %s repair only after an explicit new-repair action', async (status) => {
    const back = jest.fn();
    jest.mocked(repairPickupClient.status).mockResolvedValue({
      found: true,
      repair: {
        ticketNumber: 123,
        status,
        pickupPaymentStatus: 'booked',
        trackingNumber: 'waybill',
      },
    });
    render(<RepairPickupCheckout data={data} onBack={back} />);
    await screen.findByText('Repair ticket: 123');
    fireEvent.press(screen.getByRole('button', { name: 'Pay pickup fee' }));
    await screen.findByRole('button', { name: 'Start another repair' });
    expect(repairPickupClient.pay).not.toHaveBeenCalled();
    fireEvent.press(
      screen.getByRole('button', { name: 'Start another repair' })
    );
    await waitFor(() => expect(back).toHaveBeenCalledTimes(1));
    expect(repairPickupSession.clear).toHaveBeenCalledWith(data);
  });
});
