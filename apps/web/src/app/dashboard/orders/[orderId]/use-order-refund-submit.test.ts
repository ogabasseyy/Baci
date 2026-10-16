import { act, render } from '@testing-library/react';
import React, { useRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-client', () => ({ apiPost: vi.fn() }));

import { apiPost } from '@/lib/api-client';
import type { RefundSummary } from '@/lib/orders/refund-summary';
import { useOrderRefundSubmit } from './use-order-refund-submit';

const summary = { status: 'queued' } as unknown as RefundSummary;

function Harness({
  captured,
  overrides = {},
}: {
  captured: { submit?: (action: 'retry' | 'manual') => Promise<void> };
  overrides?: Record<string, unknown>;
}) {
  const revision = useRef(0);
  const submit = useOrderRefundSubmit({
    amount: '10',
    busy: false,
    confirmed: true,
    date: '2026-09-28T12:00',
    effectiveRemaining: 100,
    method: 'bank_transfer',
    note: 'teller 4',
    orderId: 'order-1',
    pinnedLegId: null,
    reference: 'ref-1',
    requireLeg: false,
    revision,
    setBusy: () => {},
    setConfirmed: () => {},
    setDate: () => {},
    setError: () => {},
    setLegId: () => {},
    setNote: () => {},
    setReference: () => {},
    setShowForm: () => {},
    setSummary: () => {},
    ...overrides,
  } as never);
  captured.submit = submit;
  (captured as { revision?: { current: number } }).revision = revision;
  return null;
}

function setup(overrides: Record<string, unknown> = {}) {
  const captured: {
    submit?: (action: 'retry' | 'manual') => Promise<void>;
    revision?: { current: number };
  } = {};
  const setters = {
    setBusy: vi.fn(),
    setConfirmed: vi.fn(),
    setDate: vi.fn(),
    setError: vi.fn(),
    setLegId: vi.fn(),
    setNote: vi.fn(),
    setReference: vi.fn(),
    setShowForm: vi.fn(),
    setSummary: vi.fn(),
  };
  render(
    React.createElement(Harness, {
      captured,
      overrides: { ...setters, ...overrides },
    })
  );
  return { captured, setters };
}

describe('useOrderRefundSubmit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiPost).mockResolvedValue(summary);
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
  });

  it('confirms retries and resets transfer fields on success', async () => {
    const { captured, setters } = setup();
    await act(async () => {
      await captured.submit?.('retry');
    });
    expect(window.confirm).toHaveBeenCalledWith(
      'Retry the remaining refund? Fund your Paystack balance first.'
    );
    expect(apiPost).toHaveBeenCalledWith('/api/orders/order-1/refund', {
      action: 'retry',
    });
    expect(setters.setSummary).toHaveBeenCalledWith(summary);
    expect(setters.setShowForm).toHaveBeenCalledWith(false);
    expect(setters.setConfirmed).toHaveBeenCalledWith(false);
    expect(setters.setReference).toHaveBeenCalledWith('');
    expect(setters.setDate).toHaveBeenCalledWith('');
    expect(setters.setNote).toHaveBeenCalledWith('');
    expect(setters.setLegId).toHaveBeenCalledWith('');
    expect(setters.setBusy).toHaveBeenCalledWith(false);
    expect(captured.revision?.current).toBe(2);
  });

  it('aborts the retry when the merchant declines confirmation', async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    const { captured, setters } = setup();
    await act(async () => {
      await captured.submit?.('retry');
    });
    expect(apiPost).not.toHaveBeenCalled();
    expect(setters.setBusy).not.toHaveBeenCalled();
    expect(captured.revision?.current).toBe(0);
  });

  it('validates manual input before posting', async () => {
    const { captured, setters } = setup({ amount: 'not-a-number' });
    await act(async () => {
      await captured.submit?.('manual');
    });
    expect(apiPost).not.toHaveBeenCalled();
    expect(setters.setError).toHaveBeenCalledWith(expect.any(String));
  });

  it('posts the built manual payload on valid input', async () => {
    const { captured } = setup();
    await act(async () => {
      await captured.submit?.('manual');
    });
    expect(apiPost).toHaveBeenCalledWith(
      '/api/orders/order-1/refund',
      expect.objectContaining({ action: 'manual', reference: 'ref-1' })
    );
  });

  it('surfaces request failures without clearing the form', async () => {
    vi.mocked(apiPost).mockRejectedValue(new Error('boom'));
    const { captured, setters } = setup();
    await act(async () => {
      await captured.submit?.('manual');
    });
    expect(setters.setError).toHaveBeenCalledWith('boom');
    expect(setters.setSummary).not.toHaveBeenCalled();
    expect(setters.setReference).not.toHaveBeenCalled();
    expect(setters.setBusy).toHaveBeenCalledWith(false);
    expect(captured.revision?.current).toBe(2);
  });

  it('ignores submits while busy', async () => {
    const { captured, setters } = setup({ busy: true });
    await act(async () => {
      await captured.submit?.('retry');
    });
    expect(window.confirm).not.toHaveBeenCalled();
    expect(apiPost).not.toHaveBeenCalled();
    expect(setters.setBusy).not.toHaveBeenCalled();
  });
});
