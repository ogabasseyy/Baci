import { describe, expect, it } from 'vitest';
import { maskRefundWorkerText } from './mask-refund-worker-text';

const GENERIC = 'The refund ran into a problem. Support has the details.';
const QUEUED = 'Refund in progress — queued to resume automatically.';

describe('maskRefundWorkerText', () => {
  it('drops unknown top-level keys', () => {
    expect(
      maskRefundWorkerText({
        status: 'failed',
        internal_trace_id: 'trace-1',
        debug: { sql: 'SELECT 1' },
      })
    ).toEqual({
      error: null,
      needsPaystackCheck: false,
      status: 'failed',
      history: [],
      events: [],
      eventsTruncated: false,
      historyTruncated: false,
      legs: [],
    });
  });
  it('replaces raw top-level errors with the generic label', () => {
    expect(maskRefundWorkerText({ error: 'NETWORK_ERROR' }).error).toBe(
      GENERIC
    );
    expect(maskRefundWorkerText({ error: QUEUED }).error).toBe(QUEUED);
    expect(maskRefundWorkerText({}).error).toBeNull();
  });
  it('allow-lists event details and relabels raw worker errors', () => {
    const masked = maskRefundWorkerText({
      events: [
        {
          id: 'event-1',
          action: 'retry',
          actor: 'user-1',
          date: '2026-09-28T12:00:00Z',
          details: {
            attempts: 2,
            error: 'claim_token mismatch',
            provider_secret: 'sk_live',
          },
        },
      ],
    });
    expect(masked.events).toEqual([
      {
        id: 'event-1',
        action: 'retry',
        date: '2026-09-28T12:00:00Z',
        details: { attempts: 2, error: GENERIC },
      },
    ]);
  });
  it('passes terminal-row sync details through like direct REST', () => {
    const masked = maskRefundWorkerText({
      events: [
        {
          id: 'event-9',
          action: 'manual_recorded',
          date: '2026-09-28T12:00:00Z',
          details: {
            amount: 100,
            reference: 'bank-1',
            provider_secret: 'sk_live',
          },
        },
      ],
    });
    expect(masked.events).toEqual([
      {
        id: 'event-9',
        action: 'manual_recorded',
        date: '2026-09-28T12:00:00Z',
        details: { amount: 100, reference: 'bank-1' },
      },
    ]);
  });
  it('keeps allow-listed event error labels verbatim', () => {
    const masked = maskRefundWorkerText({
      events: [{ id: 'event-2', details: { error: QUEUED } }],
    });
    expect(masked.events).toEqual([
      { id: 'event-2', details: { error: QUEUED } },
    ]);
  });
  it('drops history identity keys but keeps merchant annotations', () => {
    const masked = maskRefundWorkerText({
      history: [
        {
          id: 'refund-1',
          amount: 100,
          status: 'completed',
          method: 'bank_transfer',
          reference: 'bank-1',
          date: '2026-09-28T12:00:00Z',
          note: 'Counter payment confirmed',
          recorded_by: 'user-1',
          actor: 'user-1',
        },
      ],
    });
    expect(masked.history).toEqual([
      {
        id: 'refund-1',
        amount: 100,
        status: 'completed',
        method: 'bank_transfer',
        reference: 'bank-1',
        date: '2026-09-28T12:00:00Z',
        note: 'Counter payment confirmed',
      },
    ]);
  });
  it('preserves the provider-backed polling flag', () => {
    expect(
      maskRefundWorkerText({
        status: 'refunded',
        hasPaystackPayment: true,
      }).hasPaystackPayment
    ).toBe(true);
  });
  it('keeps the watch armed when the polling flag is missing', () => {
    // A partial payload without the flag must not read as 'no
    // Paystack payment' (that would end the contradiction watch);
    // only an explicit false disarms it.
    expect(
      maskRefundWorkerText({ status: 'refunded' }).hasPaystackPayment
    ).toBe(true);
    expect(
      maskRefundWorkerText({
        status: 'refunded',
        hasPaystackPayment: false,
      }).hasPaystackPayment
    ).toBe(false);
  });
  it('passes truncation flags through as booleans', () => {
    expect(
      maskRefundWorkerText({ eventsTruncated: true, historyTruncated: true })
    ).toMatchObject({ eventsTruncated: true, historyTruncated: true });
    // Malformed truthy input coerces to false — only a real true
    // renders a truncation note.
    expect(
      maskRefundWorkerText({ eventsTruncated: 1, historyTruncated: 'yes' })
    ).toMatchObject({ eventsTruncated: false, historyTruncated: false });
  });
  it('passes malformed entries through without throwing', () => {
    expect(
      maskRefundWorkerText({
        events: [null, 'oops', 42, { id: 'event-3', details: 'raw' }],
        history: [null, ['nested'], { id: 'refund-2' }],
      })
    ).toEqual({
      error: null,
      needsPaystackCheck: false,
      events: [null, 'oops', 42, { id: 'event-3', details: {} }],
      eventsTruncated: false,
      history: [null, ['nested'], { id: 'refund-2' }],
      historyTruncated: false,
      legs: [],
    });
  });
});
