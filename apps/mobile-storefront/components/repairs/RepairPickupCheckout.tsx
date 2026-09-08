import { type RefObject, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text } from 'react-native';
import { RepairPickupStatus } from '@/components/repairs/RepairPickupStatus';
import { repairsCatalogStyles as styles } from '@/components/repairs/repairs-catalog.styles';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useRepairPickupBack } from '@/hooks/use-repair-pickup-back';
import { isRepairPickupPaymentConfirmed } from '@/lib/is-repair-pickup-payment-confirmed';
import { openRepairPickupPayment } from '@/lib/open-repair-pickup-payment';
import type { RepairBookingRequest } from '@/lib/repair-catalog-schemas';
import { repairPickupClient } from '@/lib/repair-pickup-client';
import { repairPickupSession } from '@/lib/repair-pickup-session';

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
  const [price, setPrice] = useState<number | null>(null);
  const [ticket, setTicket] = useState<number | null>(null);
  const [resumeToken, setResumeToken] = useState<string>();
  const [paymentUrl, setPaymentUrl] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [tracking, setTracking] = useState<string | null>(null);
  const [terminal, setTerminal] = useState(false);
  const [warning, setWarning] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const inFlight = useRef(false);
  useRepairPickupBack(
    navigationBackRef,
    ready && (ticket === null || isRepairPickupPaymentConfirmed(status)),
    inFlight,
    onBack
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: Explicit retries rerun failed secure-storage recovery.
  useEffect(() => {
    let active = true;
    repairPickupSession
      .load(data)
      .then((saved) => {
        if (!active) return;
        if (saved) {
          setResumeToken(saved.resumeToken);
          setTicket(saved.ticketNumber ?? null);
          setPrice(saved.price);
          setPaymentUrl(saved.paymentUrl);
        }
        setReady(true);
      })
      .catch(() => {
        if (active) {
          setRestoreFailed(true);
          setError(
            'Could not restore pickup payment. Retry recovery before paying.'
          );
        }
      });
    return () => {
      active = false;
    };
  }, [data, restoreAttempt]);

  async function run(action: () => Promise<void>) {
    if (inFlight.current || !ready) return;
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function refresh(ticketNumber: number) {
    const result = await repairPickupClient.status(
      ticketNumber,
      data.customerEmail
    );
    if (!result.found)
      throw new Error(
        'Status unavailable. Keep your ticket and try again shortly.'
      );
    setStatus(result.repair.pickupPaymentStatus ?? 'pending');
    setTracking(result.repair.trackingNumber);
    setTerminal(
      ['completed', 'cancelled', 'rejected'].includes(result.repair.status)
    );
  }

  async function pay() {
    if (price === null) return;
    if (ticket) {
      const current = await repairPickupClient.status(
        ticket,
        data.customerEmail
      );
      if (!current.found)
        throw new Error('Check your pickup status before retrying payment.');
      setStatus(current.repair.pickupPaymentStatus ?? 'pending');
      setTracking(current.repair.trackingNumber);
      if (
        ['completed', 'cancelled', 'rejected'].includes(current.repair.status)
      ) {
        setTerminal(true);
        return;
      }
      if (
        current.repair.trackingNumber ||
        (current.repair.pickupPaymentStatus &&
          current.repair.pickupPaymentStatus !== 'awaiting_payment')
      )
        return;
    }
    let url = paymentUrl;
    let ticketNumber = ticket;
    if (!url) {
      const result = await repairPickupClient.pay(data, price, resumeToken);
      if (result.resumeToken) setResumeToken(result.resumeToken);
      if (result.ticketNumber) setTicket(result.ticketNumber);
      if (result.success) {
        url = result.payment.authorizationUrl;
        ticketNumber = result.ticketNumber;
        setPaymentUrl(url);
        setPrice(result.payment.amount);
      }
      if (result.resumeToken)
        await repairPickupSession
          .save(data, {
            resumeToken: result.resumeToken,
            ticketNumber: result.ticketNumber,
            price: result.success ? result.payment.amount : price,
            paymentUrl: result.success
              ? result.payment.authorizationUrl
              : undefined,
          })
          .catch(() =>
            setWarning(
              'Payment recovery could not be saved. Keep your repair ticket and this screen open.'
            )
          );
      if (!result.success) {
        if (result.code === 'resume_invalid') {
          setResumeToken(undefined);
          await repairPickupSession
            .clear(data)
            .catch(() =>
              setWarning(
                'Recovery storage could not be cleared. Keep this screen open.'
              )
            );
        }
        if (result.quote) setPrice(result.quote.price);
        throw new Error(result.error);
      }
      if (result.payment.amount !== price) {
        setWarning(
          'Recovered your earlier payment. Review its pickup fee before continuing.'
        );
        return;
      }
    }
    // Closing the browser is not payment confirmation; only read server status.
    await openRepairPickupPayment(url);
    if (ticketNumber) await refresh(ticketNumber);
  }

  const paid = Boolean(
    status && status !== 'awaiting_payment' && status !== 'pending'
  );
  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <Text style={[styles.emptyText, { color: colors.text }]}>
        GIG Logistics pickup
      </Text>
      <Text style={{ color: colors.text }}>{data.pickupAddress}</Text>
      {price !== null && (
        <Text style={[styles.emptyText, { color: colors.text }]}>
          Pickup fee: NGN {price.toLocaleString()}
        </Text>
      )}
      {ticket !== null && (
        <Text selectable style={{ color: colors.text }}>
          Repair ticket: {ticket}
        </Text>
      )}
      <RepairPickupStatus
        status={status}
        tracking={tracking}
        paid={paid}
        hasTicket={ticket !== null}
      />
      {status && (
        <Text style={{ color: colors.text }}>
          Pickup status: {status.replaceAll('_', ' ')}
        </Text>
      )}
      {error && (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {error}
        </Text>
      )}
      {warning && <Text style={{ color: colors.text }}>{warning}</Text>}
      {terminal && (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          style={styles.secondaryButton}
          onPress={() =>
            run(async () => {
              await repairPickupSession.clear(data);
              onBack();
            })
          }
        >
          <Text style={styles.secondaryButtonText}>Start another repair</Text>
        </Pressable>
      )}
      {restoreFailed && (
        <Pressable
          accessibilityRole="button"
          style={styles.secondaryButton}
          onPress={() => {
            setRestoreFailed(false);
            setError(undefined);
            setRestoreAttempt((value) => value + 1);
          }}
        >
          <Text style={styles.secondaryButtonText}>Retry payment recovery</Text>
        </Pressable>
      )}
      {(busy || (!ready && !restoreFailed)) && (
        <ActivityIndicator accessibilityLabel="Loading pickup" />
      )}
      {price === null ? (
        <Pressable
          accessibilityRole="button"
          disabled={busy || !ready}
          style={styles.primaryButton}
          onPress={() =>
            run(async () => {
              const quote = await repairPickupClient.quote(data);
              setPrice(quote.price);
            })
          }
        >
          <Text style={styles.primaryButtonText}>Get pickup fee</Text>
        </Pressable>
      ) : !paid && !tracking && !terminal ? (
        <Pressable
          accessibilityRole="button"
          disabled={busy || !ready}
          style={styles.primaryButton}
          onPress={() => run(pay)}
        >
          <Text style={styles.primaryButtonText}>
            {paymentUrl ? 'Continue payment' : 'Pay pickup fee'}
          </Text>
        </Pressable>
      ) : null}
      {ticket !== null && (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          style={styles.secondaryButton}
          onPress={() => run(() => refresh(ticket))}
        >
          <Text style={styles.secondaryButtonText}>Refresh pickup status</Text>
        </Pressable>
      )}
      {ticket === null && (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
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
