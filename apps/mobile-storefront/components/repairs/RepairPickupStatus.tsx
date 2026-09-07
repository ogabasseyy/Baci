import { Text } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

export function RepairPickupStatus({
  status,
  tracking,
  hasTicket,
  paid,
}: {
  status?: string;
  tracking: string | null;
  hasTicket: boolean;
  paid: boolean;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const message = tracking
    ? `Pickup booked. Waybill: ${tracking}`
    : status === 'review'
      ? 'Pickup needs review. Contact the store with your repair ticket; do not pay again.'
      : status === 'manual_fulfilled'
        ? 'The store has arranged your pickup.'
        : paid
          ? 'Payment received. Pickup confirmation is pending.'
          : hasTicket
            ? 'Awaiting payment confirmation.'
            : null;
  return message ? (
    <Text selectable={Boolean(tracking)} style={{ color: colors.text }}>
      {message}
    </Text>
  ) : null;
}
