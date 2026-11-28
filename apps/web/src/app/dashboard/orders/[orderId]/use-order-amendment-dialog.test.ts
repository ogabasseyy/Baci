// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AmendmentRequestError,
  requestAmendment,
} from './order-amendment-client';
import { useOrderAmendmentDialog } from './use-order-amendment-dialog';

vi.mock('./order-amendment-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./order-amendment-client')>()),
  requestAmendment: vi.fn(),
}));

const lineId = '11111111-1111-4111-8111-111111111111';
const replacementId = '22222222-2222-4222-8222-222222222222';
const previewId = '33333333-3333-4333-8333-333333333333';
const path = '/api/orders/synthetic/amendments';
const request = vi.mocked(requestAmendment);

async function prepared({
  adjustmentMinor = 0,
  canRefund = true,
  bankEvidence,
}: {
  adjustmentMinor?: number;
  canRefund?: boolean;
  bankEvidence?: { id: string; amountMinor: number; occurredAt: string }[];
} = {}) {
  const onConfirmed = vi.fn();
  const onConflict = vi.fn();
  const resolveConfirmation =
    vi.fn<() => Promise<'confirmed' | 'competing' | 'unknown'>>();
  const hook = renderHook(() =>
    useOrderAmendmentDialog({
      path,
      currency: 'NGN',
      items: [{ id: lineId, name: 'Original', quantity: 1, price: 5000 }],
      canRefund,
      onClose: vi.fn(),
      onConfirmed,
      onConflict,
      resolveConfirmation,
    })
  );
  const { result } = hook;
  request.mockResolvedValueOnce([
    { id: replacementId, kind: 'product', label: 'Replacement' },
  ]);
  act(() => result.current.setSearch(' phone '));
  await act(async () => result.current.findReplacements());
  expect(request).toHaveBeenLastCalledWith(
    `${path}?lineId=${lineId}&search=phone`
  );

  act(() => result.current.setSelected(replacementId));
  request.mockResolvedValueOnce({
    previewId,
    expiresAt: '2026-11-22T09:30:00Z',
    beforeLine: { name: 'Original', unitPriceMinor: 500_000, quantity: 1 },
    afterLine: {
      name: 'Replacement',
      unitPriceMinor: 500_000 + adjustmentMinor,
      quantity: 1,
    },
    beforeTotalMinor: 500_000,
    afterTotalMinor: 500_000 + adjustmentMinor,
    adjustmentMinor,
    bankEvidence,
  });
  await act(async () => result.current.fetchPreview());
  act(() => {
    result.current.setReason(' Customer requested a swap. ');
    result.current.setCustomerAgreed(true);
  });
  return { result, onConfirmed, onConflict, resolveConfirmation };
}

describe('useOrderAmendmentDialog', () => {
  beforeEach(() => request.mockReset());

  it('confirms the prepared preview with consent and one submission key', async () => {
    const { result, onConfirmed, resolveConfirmation } = await prepared();
    request.mockResolvedValueOnce({ amendmentId: lineId });
    await act(async () => result.current.confirm());

    expect(request).toHaveBeenLastCalledWith(path, {
      previewId,
      customerAgreed: true,
      reason: 'Customer requested a swap.',
      idempotencyKey: expect.any(String),
    });
    expect(onConfirmed).toHaveBeenCalledOnce();
    expect(resolveConfirmation).not.toHaveBeenCalled();
  });

  it('discards a stale preview and clears consent', async () => {
    const { result, onConfirmed, resolveConfirmation } = await prepared();
    request.mockRejectedValueOnce(
      new AmendmentRequestError('Preview again.', 'preview_stale', 409)
    );
    await act(async () => result.current.confirm());

    expect(result.current.preview).toBeNull();
    expect(result.current.customerAgreed).toBe(false);
    expect(result.current.error).toBe('Preview again.');
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(resolveConfirmation).not.toHaveBeenCalled();
  });

  it('requires selection of a verified transfer for a verified-funds upgrade', async () => {
    const amountMinor = 2_000_000;
    const evidenceId = '44444444-4444-4444-8444-444444444444';
    const { result, onConfirmed } = await prepared({
      adjustmentMinor: amountMinor,
      bankEvidence: [
        { id: evidenceId, amountMinor, occurredAt: '2026-11-22T09:00:00Z' },
      ],
    });
    request.mockClear();
    await act(async () => result.current.confirm());
    expect(request).not.toHaveBeenCalled();
    act(() => result.current.setBankEvidenceId(evidenceId));
    request.mockResolvedValueOnce({ amendmentId: lineId });
    await act(async () => result.current.confirm());
    expect(request).toHaveBeenCalledWith(
      path,
      expect.objectContaining({ bankEvidenceId: evidenceId })
    );
    expect(onConfirmed).toHaveBeenCalledOnce();
  });

  it('reports a competing confirmation found by the authorized lookup', async () => {
    const { result, onConfirmed, onConflict, resolveConfirmation } =
      await prepared();
    resolveConfirmation.mockResolvedValueOnce('competing');
    request.mockRejectedValueOnce(
      new AmendmentRequestError('Already amended.', 'already_amended', 409)
    );
    await act(async () => result.current.confirm());

    expect(onConflict).toHaveBeenCalledOnce();
    expect(onConfirmed).not.toHaveBeenCalled();
  });

  it('keeps the exact request when the first submission outcome is unknown', async () => {
    const { result, onConfirmed, resolveConfirmation } = await prepared();
    resolveConfirmation.mockResolvedValueOnce('unknown');
    request.mockRejectedValueOnce(new Error('Network interrupted'));
    await act(async () => result.current.confirm());

    const firstAttempt = request.mock.lastCall;
    const body = firstAttempt?.[1] as { idempotencyKey: string };
    expect(result.current.uncertain).toBe(true);
    expect(resolveConfirmation).toHaveBeenCalledWith(body.idempotencyKey);

    request.mockResolvedValueOnce({ amendmentId: lineId });
    await act(async () => result.current.confirm());

    expect(request.mock.lastCall).toEqual(firstAttempt);
    expect(onConfirmed).toHaveBeenCalledOnce();
  });

  it('rejects a lower-price confirmation without refund permission', async () => {
    const { result, onConfirmed } = await prepared({
      adjustmentMinor: -50_000,
      canRefund: false,
    });
    request.mockClear();
    await act(async () => result.current.confirm());

    expect(request).not.toHaveBeenCalled();
    expect(onConfirmed).not.toHaveBeenCalled();
  });
});
