'use client';

import { useState } from 'react';
import type { z } from 'zod';
import { formatDisplayCurrency } from '@/lib/format-display-currency';
import {
  amendmentPreviewResult,
  replacementsSchema,
} from '@/schemas/order-amendment';
import type { OrderDetailsItem } from '../order-items';
import {
  AmendmentRequestError,
  requestAmendment,
} from './order-amendment-client';

export type AmendmentDialogProps = {
  path: string;
  items: OrderDetailsItem[];
  currency: string;
  canRefund: boolean;
  onClose: () => void;
  onConfirmed: () => void;
  onConflict: () => void;
  resolveConfirmation: (
    confirmationKey: string
  ) => Promise<'confirmed' | 'competing' | 'unknown'>;
};

export function useOrderAmendmentDialog({
  path,
  items,
  currency,
  canRefund,
  onConfirmed,
  onConflict,
  resolveConfirmation,
}: AmendmentDialogProps) {
  const [lineId, setLineId] = useState(items[0]?.id ?? '');
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<z.infer<typeof replacementsSchema>>(
    []
  );
  const [selected, setSelected] = useState('');
  const [preview, setPreview] = useState<z.infer<
    typeof amendmentPreviewResult
  > | null>(null);
  const [reason, setReason] = useState('');
  const [customerAgreed, setCustomerAgreed] = useState(false);
  const [key, setKey] = useState('');
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const money = (minor: number) => formatDisplayCurrency(minor / 100, currency);
  const replacement = options.find((option) => option.id === selected);

  async function run(work: () => Promise<void>) {
    setError('');
    setPending(true);
    try {
      await work();
    } catch (failure) {
      setError(
        failure instanceof AmendmentRequestError
          ? failure.message
          : 'Unable to complete this request. Try again.'
      );
    } finally {
      setPending(false);
    }
  }

  async function findReplacements() {
    setPreview(null);
    setSelected('');
    setOptions([]);
    await run(async () => {
      const query = new URLSearchParams({ lineId, search: search.trim() });
      const found = replacementsSchema.parse(
        await requestAmendment(`${path}?${query}`)
      );
      setOptions(found);
      if (found.length === 0)
        setError('No matching replacements are available.');
    });
  }

  async function fetchPreview() {
    if (!replacement) return;
    await run(async () => {
      setPreview(
        amendmentPreviewResult.parse(
          await requestAmendment(`${path}/preview`, {
            lineId,
            replacement: { id: replacement.id, kind: replacement.kind },
          })
        )
      );
      setKey(crypto.randomUUID());
      setCustomerAgreed(false);
    });
  }

  async function checkConfirmation() {
    const outcome = await resolveConfirmation(key);
    if (outcome === 'confirmed') {
      onConfirmed();
      return;
    }
    if (outcome === 'competing') {
      onConflict();
      return;
    }
    setUncertain(true);
    setError(
      'The confirmation could not be verified. Check its status before changing the selection.'
    );
  }

  async function confirm() {
    if (
      !preview ||
      !customerAgreed ||
      !reason.trim() ||
      (preview.adjustmentMinor < 0 && !canRefund)
    )
      return;
    await run(async () => {
      try {
        await requestAmendment(path, {
          previewId: preview.previewId,
          customerAgreed,
          reason: reason.trim(),
          idempotencyKey: key,
        });
      } catch (failure) {
        if (
          failure instanceof AmendmentRequestError &&
          ['preview_stale', 'replacement_unavailable'].includes(
            failure.code ?? ''
          )
        ) {
          setPreview(null);
          setUncertain(false);
          setCustomerAgreed(false);
          throw failure;
        }
        if (
          failure instanceof AmendmentRequestError &&
          (failure.status ?? 500) < 500 &&
          failure.code !== 'already_amended'
        ) {
          throw failure;
        }
        await checkConfirmation();
        return;
      }
      onConfirmed();
    });
  }

  return {
    lineId,
    setLineId,
    search,
    setSearch,
    options,
    setOptions,
    selected,
    setSelected,
    preview,
    setPreview,
    reason,
    setReason,
    customerAgreed,
    setCustomerAgreed,
    pending,
    uncertain,
    error,
    findReplacements,
    fetchPreview,
    checkConfirmation,
    confirm,
    run,
    money,
  };
}
