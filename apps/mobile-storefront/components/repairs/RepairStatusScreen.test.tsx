import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { repairPickupClient } from '@/lib/repair-pickup-client';
import { RepairStatusScreen } from './RepairStatusScreen';

jest.mock('expo-router', () => ({ Stack: { Screen: () => null } }));
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
jest.mock('@/lib/repair-pickup-client', () => ({
  repairPickupClient: { status: jest.fn() },
}));

describe('RepairStatusScreen', () => {
  it('reserves the bottom system inset around the scrolling status content', () => {
    const view = render(<RepairStatusScreen />);
    expect(view.UNSAFE_getByType(SafeAreaView).props.edges).toEqual(['bottom']);
  });
  beforeEach(() => jest.clearAllMocks());
  it('shows the authenticated-by-ticket-and-email status and waybill', async () => {
    jest.mocked(repairPickupClient.status).mockResolvedValue({
      found: true,
      repair: {
        status: 'in_progress',
        ticketNumber: 123,
        trackingNumber: '1349612345',
        pickupPaymentStatus: 'booked',
      },
    });
    render(<RepairStatusScreen />);
    fireEvent.changeText(screen.getByLabelText('Ticket number'), '123');
    fireEvent.changeText(
      screen.getByLabelText('Booking email'),
      'test@example.com'
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Check repair status' })
    );
    await screen.findByText('GIGL waybill: 1349612345');
    expect(repairPickupClient.status).toHaveBeenCalledWith(
      123,
      'test@example.com'
    );
  });
  it('does not submit an empty lookup', () => {
    render(<RepairStatusScreen />);
    fireEvent.press(
      screen.getByRole('button', { name: 'Check repair status' })
    );
    expect(repairPickupClient.status).not.toHaveBeenCalled();
  });
});
