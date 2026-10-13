import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import { requestCheckoutShippingRecovery } from '@/lib/checkout-shipping-recovery';
import type { checkoutShippingRecoverySchema } from '@/schemas/checkout-shipping-recovery';

type Preview = z.infer<typeof checkoutShippingRecoverySchema>;
interface Draft {
  address: string;
  city: string;
  state: string;
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
      setError(
        'This quote differs from the paid shipping amount. It cannot be saved here. Contact support to review this order.'
      );
      return;
    }
    if (
      !Number.isFinite(Date.parse(preview.quote.expiresAt)) ||
      Date.parse(preview.quote.expiresAt) <= Date.now()
    ) {
      setPreview(null);
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
      }
    } catch (cause) {
      if (token === generation.current) {
        setPreview(null);
        setError(
          cause instanceof Error ? cause.message : 'Could not confirm shipping.'
        );
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
