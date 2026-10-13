import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { openRepairPickupPayment } from '@/lib/open-repair-pickup-payment';
import type { RepairBookingRequest } from '@/lib/repair-catalog-schemas';
import { repairPickupClient } from '@/lib/repair-pickup-client';
import { repairPickupSession } from '@/lib/repair-pickup-session';
import type { RepairPickupSession } from '@/schemas/repair-pickup';

const TERMINAL_REPAIR_STATUSES = ['completed', 'cancelled', 'rejected'];

export function useRepairPickupCheckoutPayment(
  data: RepairBookingRequest,
  recovery: { ready: boolean; saved: RepairPickupSession | null }
) {
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
  const inFlight = useRef(false);
  const browserOpened = useRef(false);
  const { ready, saved } = recovery;

  useEffect(() => {
    if (!saved) return;
    setResumeToken(saved.resumeToken);
    setTicket(saved.ticketNumber ?? null);
    setPrice(saved.price);
    setPaymentUrl(saved.paymentUrl);
  }, [saved]);

  const customerEmail = data.customerEmail;
  useEffect(() => {
    if (!ticket) return;
    const subscription = AppState.addEventListener('change', (state) => {
      // Android resolves the browser promise at open time, so the inline
      // refresh in pay() runs before checkout. Refresh once on return.
      if (state !== 'active' || !browserOpened.current) return;
      browserOpened.current = false;
      repairPickupClient
        .status(ticket, customerEmail)
        .then((result) => {
          if (!result.found) return;
          setStatus(result.repair.pickupPaymentStatus ?? 'pending');
          setTracking(result.repair.trackingNumber);
          setTerminal(TERMINAL_REPAIR_STATUSES.includes(result.repair.status));
        })
        .catch(() => {
          // Keep the last status; manual Refresh stays available.
        });
    });
    return () => subscription.remove();
  }, [ticket, customerEmail]);

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
    setTerminal(TERMINAL_REPAIR_STATUSES.includes(result.repair.status));
  }

  async function quote() {
    const quoted = await repairPickupClient.quote(data);
    setPrice(quoted.price);
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
      if (TERMINAL_REPAIR_STATUSES.includes(current.repair.status)) {
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
    browserOpened.current = true;
    if (ticketNumber) await refresh(ticketNumber);
  }

  async function startAnother(onBack: () => void) {
    await repairPickupSession.clear(data);
    onBack();
  }

  return {
    busy,
    error,
    inFlight,
    pay,
    paymentUrl,
    price,
    quote,
    refresh,
    run,
    startAnother,
    status,
    terminal,
    ticket,
    tracking,
    warning,
  };
}
