import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import { requestCheckoutShippingRecovery } from '@/lib/checkout-shipping-recovery';
import type { checkoutShippingRecoverySchema } from '@/schemas/checkout-shipping-recovery';

type Preview = z.infer<typeof checkoutShippingRecoverySchema>;

// Failures that retrying the same preview cannot resolve. Transport errors,
// timeouts and 5xx responses stay ambiguous: the server may have committed,
// so the preview is retained for a safe idempotent retry.
const DEFINITIVE_RECOVERY_FAILURE =
  /expir|stale|order changed|preview again|no longer eligible|differs from the paid|destination confirmation|complete destination|forbidden/i;

function isDefinitiveRecoveryFailure(message: string): boolean {
  return DEFINITIVE_RECOVERY_FAILURE.test(message);
}
interface Draft {
  address: string;
  city: string;
  state: string;
  countryCode: string;
  phone: string;
  latitude: string;
  longitude: string;
}

export function useCheckoutShippingRecovery(orderId: string, initial: Draft) {
  const client = useQueryClient();
  const [draft, setDraft] = useState(initial);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const generation = useRef(0);
  const active = useRef(false);
  const identity = useRef(orderId);
  // A retained preview after an ambiguous confirmation failure may still reach
  // the idempotent server RPC even past its local expiry: the server checks
  // confirmed_at before expiry, so this exact retry can return success.
  const ambiguousConfirmRetry = useRef(false);
  useEffect(() => {
    identity.current = orderId;
    return () => {
      generation.current++;
    };
  }, [orderId]);
  const update = (changes: Partial<Draft>) => {
    generation.current++;
    setDraft((previous) => ({ ...previous, ...changes }));
    setPreview(null);
    setConfirmed(false);
    setError(null);
    ambiguousConfirmRetry.current = false;
  };
  const requestPreview = async () => {
    if (active.current) return;
    const latitude = Number(draft.latitude);
    const longitude = Number(draft.longitude);
    if (
      !draft.latitude.trim() ||
      !draft.longitude.trim() ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180 ||
      ['address', 'city', 'state', 'phone'].some(
        (key) => !draft[key as keyof Draft].trim()
      )
    ) {
      setError(
        'Enter the destination, phone and a complete valid latitude/longitude pin.'
      );
      return;
    }
    const token = ++generation.current;
    active.current = true;
    setBusy(true);
    setError(null);
    setPreview(null);
    setConfirmed(false);
    ambiguousConfirmRetry.current = false;
    try {
      const result = await requestCheckoutShippingRecovery(orderId, {
        action: 'preview',
        receiver: { ...draft, latitude, longitude },
      });
      if (token === generation.current && 'previewId' in result)
        setPreview(result);
    } catch (cause) {
      if (token === generation.current)
        setError(
          cause instanceof Error ? cause.message : 'Could not preview shipping.'
        );
    } finally {
      active.current = false;
      setBusy(false);
    }
  };
  const confirm = async () => {
    if (active.current || !preview?.previewId || !preview.canConfirm) return;
    if (
      Math.round(preview.quote.price * 100) !==
      Math.round(preview.paidShippingFee * 100)
    ) {
      setPreview(null);
      ambiguousConfirmRetry.current = false;
      setError(
        'This quote differs from the paid shipping amount. It cannot be saved here. Contact support to review this order.'
      );
      return;
    }
    if (
      (!Number.isFinite(Date.parse(preview.quote.expiresAt)) ||
        Date.parse(preview.quote.expiresAt) <= Date.now()) &&
      !ambiguousConfirmRetry.current
    ) {
      setPreview(null);
      ambiguousConfirmRetry.current = false;
      setError('Quote expired. Preview a new quote.');
      return;
    }
    const token = generation.current;
    active.current = true;
    setBusy(true);
    setError(null);
    try {
      await requestCheckoutShippingRecovery(orderId, {
        action: 'confirm',
        previewId: preview.previewId,
        confirmDestination: true,
      });
      void client.invalidateQueries({ queryKey: ['order', orderId] });
      void client.invalidateQueries({ queryKey: ['orders'] });
      if (token === generation.current) {
        setConfirmed(true);
        setPreview(null);
        ambiguousConfirmRetry.current = false;
      }
    } catch (cause) {
      if (token === generation.current) {
        const message =
          cause instanceof Error
            ? cause.message
            : 'Could not confirm shipping.';
        // Confirmation is idempotent for the same preview: a lost or failed
        // response may follow a committed server update, so keep the preview
        // for retry and clear it only for definitive rejections.
        if (isDefinitiveRecoveryFailure(message)) {
          setPreview(null);
          ambiguousConfirmRetry.current = false;
        } else {
          ambiguousConfirmRetry.current = true;
        }
        setError(message);
      }
    } finally {
      active.current = false;
      setBusy(false);
    }
  };
  return {
    draft,
    preview,
    error,
    busy,
    confirmed,
    update,
    requestPreview,
    confirm,
  };
}
