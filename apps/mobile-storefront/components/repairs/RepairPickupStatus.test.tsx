import { render, screen } from '@testing-library/react-native';
import { RepairPickupStatus } from './RepairPickupStatus';

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
it('distinguishes manual review from confirmed payment', () => {
  render(<RepairPickupStatus status="review" tracking={null} hasTicket paid />);
  expect(screen.getByText(/do not pay again/)).toBeTruthy();
  expect(screen.queryByText(/Payment received/)).toBeNull();
});
it('shows the confirmed waybill', () => {
  render(
    <RepairPickupStatus status="booked" tracking="12345" hasTicket paid />
  );
  expect(screen.getByText('Pickup booked. Waybill: 12345')).toBeTruthy();
});
