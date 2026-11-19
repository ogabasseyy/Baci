import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AuthenticatedFetchPreflightError } from '@/hooks/orders/authenticated-fetch';
import {
  GiglExternalWaybillError,
  linkOrderGiglExternalWaybill,
  previewOrderGiglExternalWaybill,
} from '@/lib/order-gigl-external-waybill';
import {
  type GiglExternalWaybillLinkResult,
  type GiglExternalWaybillPreview,
  giglExternalWaybillInputSchema,
} from '@/schemas/gigl-external-waybill';

export type GiglExternalWaybillState =
  | 'idle'
  | 'checking'
  | 'preview'
  | 'linking';

const UNCONFIRMED_LINK_MESSAGE =
  'We could not confirm the result. Check this order before trying again; the waybill may already be attached.';

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

interface UseOrderGiglExternalWaybillParams {
  orderId: string;
  /** Saves anything the sheet collected (IMEI, serials) before linking. */
  beforeLink?: () => Promise<void>;
  onLinked: (result: GiglExternalWaybillLinkResult) => void;
}

/**
 * Staff typed a waybill they booked in GIG's own app: check it with GIG via
 * the server, show who it is for, then attach it so Baci tracks it.
 */
export function useOrderGiglExternalWaybill({
  beforeLink,
  orderId,
  onLinked,
}: UseOrderGiglExternalWaybillParams) {
  const queryClient = useQueryClient();
  const [waybill, setWaybillValue] = useState('');
  const [state, setState] = useState<GiglExternalWaybillState>('idle');
  const [preview, setPreview] = useState<GiglExternalWaybillPreview | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setWaybillValue('');
    setPreview(null);
    setError(null);
    setState('idle');
  };

  const setWaybill = (value: string) => {
    setWaybillValue(value);
    setPreview(null);
    setError(null);
    setState('idle');
  };

  const check = async () => {
    const parsed = giglExternalWaybillInputSchema.safeParse(waybill);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter a valid waybill.');
      return;
    }
    setError(null);
    setState('checking');
    try {
      setPreview(await previewOrderGiglExternalWaybill(orderId, parsed.data));
      setState('preview');
    } catch (cause) {
      setPreview(null);
      setError(errorMessage(cause, 'Could not check this waybill.'));
      setState('idle');
    }
  };

  const refreshOrder = () => {
    for (const queryKey of [
      ['order', orderId],
      ['orders'],
      ['order-counts'],
      ['dashboard-stats'],
    ]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  };

  const link = async () => {
    if (!preview?.linkable) return;
    setError(null);
    setState('linking');
    try {
      await beforeLink?.();
    } catch (cause) {
      setError(errorMessage(cause, 'Could not save the order details.'));
      setState('preview');
      return;
    }
    try {
      const result = await linkOrderGiglExternalWaybill(
        orderId,
        preview.waybill
      );
      refreshOrder();
      reset();
      onLinked(result);
    } catch (cause) {
      // A lost response, or a gateway error without our error code, cannot
      // prove the link failed: refresh the order instead of inviting a retry.
      const definitive =
        cause instanceof AuthenticatedFetchPreflightError ||
        (cause instanceof GiglExternalWaybillError &&
          (cause.status < 500 || Boolean(cause.code)));
      if (!definitive) refreshOrder();
      setError(
        definitive
          ? errorMessage(cause, 'Could not attach this waybill.')
          : UNCONFIRMED_LINK_MESSAGE
      );
      setState('preview');
    }
  };

  return { check, error, link, preview, reset, setWaybill, state, waybill };
}

export type OrderGiglExternalWaybill = ReturnType<
  typeof useOrderGiglExternalWaybill
>;
