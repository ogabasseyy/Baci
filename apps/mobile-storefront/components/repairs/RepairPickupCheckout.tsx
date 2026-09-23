import type { RefObject } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text } from 'react-native';
import { RepairPickupStatus } from '@/components/repairs/RepairPickupStatus';
import { repairsCatalogStyles as styles } from '@/components/repairs/repairs-catalog.styles';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useRepairPickupBack } from '@/hooks/use-repair-pickup-back';
import { useRepairPickupCheckoutPayment } from '@/hooks/use-repair-pickup-checkout-payment';
import { useRepairPickupCheckoutRecovery } from '@/hooks/use-repair-pickup-checkout-recovery';
import { isRepairPickupPaymentConfirmed } from '@/lib/is-repair-pickup-payment-confirmed';
import type { RepairBookingRequest } from '@/lib/repair-catalog-schemas';

export function RepairPickupCheckout({
  data,
  onBack,
  navigationBackRef,
}: {
  data: RepairBookingRequest;
  onBack: () => void;
  navigationBackRef?: RefObject<(() => void) | null>;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const recovery = useRepairPickupCheckoutRecovery(data);
  const payment = useRepairPickupCheckoutPayment(data, recovery);
  useRepairPickupBack(
    navigationBackRef,
    recovery.ready &&
      (payment.ticket === null ||
        isRepairPickupPaymentConfirmed(payment.status)),
    payment.inFlight,
    onBack
  );

  const error = recovery.restoreFailed
    ? 'Could not restore pickup payment. Retry recovery before paying.'
    : payment.error;
  const ticket = payment.ticket;
  const paid = Boolean(
    payment.status &&
      payment.status !== 'awaiting_payment' &&
      payment.status !== 'pending'
  );
  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <Text style={[styles.emptyText, { color: colors.text }]}>
        GIG Logistics pickup
      </Text>
      <Text style={{ color: colors.text }}>{data.pickupAddress}</Text>
      {payment.price !== null && (
        <Text style={[styles.emptyText, { color: colors.text }]}>
          Pickup fee: NGN {payment.price.toLocaleString()}
        </Text>
      )}
      {ticket !== null && (
        <Text selectable style={{ color: colors.text }}>
          Repair ticket: {ticket}
        </Text>
      )}
      <RepairPickupStatus
        status={payment.status}
        tracking={payment.tracking}
        paid={paid}
        hasTicket={ticket !== null}
      />
      {payment.status && (
        <Text style={{ color: colors.text }}>
          Pickup status: {payment.status.replaceAll('_', ' ')}
        </Text>
      )}
      {error && (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {error}
        </Text>
      )}
      {payment.warning && (
        <Text style={{ color: colors.text }}>{payment.warning}</Text>
      )}
      {payment.terminal && (
        <Pressable
          accessibilityRole="button"
          disabled={payment.busy}
          style={styles.secondaryButton}
          onPress={() => payment.run(() => payment.startAnother(onBack))}
        >
          <Text style={styles.secondaryButtonText}>Start another repair</Text>
        </Pressable>
      )}
      {recovery.restoreFailed && (
        <Pressable
          accessibilityRole="button"
          style={styles.secondaryButton}
          onPress={recovery.retryRestore}
        >
          <Text style={styles.secondaryButtonText}>Retry payment recovery</Text>
        </Pressable>
      )}
      {(payment.busy || (!recovery.ready && !recovery.restoreFailed)) && (
        <ActivityIndicator accessibilityLabel="Loading pickup" />
      )}
      {payment.price === null ? (
        <Pressable
          accessibilityRole="button"
          disabled={payment.busy || !recovery.ready}
          style={styles.primaryButton}
          onPress={() => payment.run(payment.quote)}
        >
          <Text style={styles.primaryButtonText}>Get pickup fee</Text>
        </Pressable>
      ) : !paid && !payment.tracking && !payment.terminal ? (
        <Pressable
          accessibilityRole="button"
          disabled={payment.busy || !recovery.ready}
          style={styles.primaryButton}
          onPress={() => payment.run(payment.pay)}
        >
          <Text style={styles.primaryButtonText}>
            {payment.paymentUrl ? 'Continue payment' : 'Pay pickup fee'}
          </Text>
        </Pressable>
      ) : null}
      {ticket !== null && (
        <Pressable
          accessibilityRole="button"
          disabled={payment.busy}
          style={styles.secondaryButton}
          onPress={() => payment.run(() => payment.refresh(ticket))}
        >
          <Text style={styles.secondaryButtonText}>Refresh pickup status</Text>
        </Pressable>
      )}
      {ticket === null && (
        <Pressable
          accessibilityRole="button"
          disabled={payment.busy}
          style={styles.secondaryButton}
          onPress={onBack}
        >
          <Text style={styles.secondaryButtonText}>
            Edit details or choose drop-off
          </Text>
        </Pressable>
      )}
    </ScrollView>
  );
}
