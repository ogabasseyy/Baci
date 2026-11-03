import { describe, expect, it, vi } from 'vitest';
import type { PiggyvestWebhookEvent } from '@/schemas/piggyvest/events';
import { InflowLedgerError } from './inflow-ledger';
import {
  alertOncePerEvent,
  alertUnmappedInflow,
  resetUnmappedAlertMemoryForTests,
} from './unmapped-alert-once';

const mockAlert = vi.hoisted(() => vi.fn());
vi.mock('./webhook-alerts', () => ({
  emitPiggyvestWebhookAlertDelivered: mockAlert,
}));

describe('alertOncePerEvent', () => {
  it('raises the alert once for repeated deliveries of the same event', async () => {
    resetUnmappedAlertMemoryForTests();
    const emit = vi.fn().mockResolvedValue(true);
    await alertOncePerEvent('evt-1', emit);
    await alertOncePerEvent('evt-1', emit);
    await alertOncePerEvent('evt-1', emit);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('raises a separate alert for a different event', async () => {
    resetUnmappedAlertMemoryForTests();
    const emit = vi.fn().mockResolvedValue(true);
    await alertOncePerEvent('evt-1', emit);
    await alertOncePerEvent('evt-2', emit);
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['resolves false', () => Promise.resolve(false)],
    ['rejects', () => Promise.reject(new Error('alert down'))],
    [
      'throws synchronously',
      () => {
        throw new Error('alert down');
      },
    ],
  ])('pages again on the next delivery when the send %s', async (_n, fail) => {
    resetUnmappedAlertMemoryForTests();
    const emit = vi
      .fn<() => Promise<boolean>>()
      .mockImplementationOnce(fail)
      .mockResolvedValue(true);
    await alertOncePerEvent('evt-1', emit).catch(() => undefined);
    await alertOncePerEvent('evt-1', emit);
    await alertOncePerEvent('evt-1', emit);
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it('does not double-page concurrent redeliveries', async () => {
    resetUnmappedAlertMemoryForTests();
    let release: (v: boolean) => void = () => undefined;
    const emit = vi.fn(
      () => new Promise<boolean>((resolve) => (release = resolve))
    );
    const first = alertOncePerEvent('evt-1', emit);
    const second = alertOncePerEvent('evt-1', emit);
    release(true);
    await Promise.all([first, second]);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('forgets the oldest events once the memory is full', async () => {
    resetUnmappedAlertMemoryForTests();
    const emit = vi.fn().mockResolvedValue(true);
    for (let i = 0; i < 600; i += 1) await alertOncePerEvent(`evt-${i}`, emit);
    emit.mockClear();
    await alertOncePerEvent('evt-599', emit);
    expect(emit).not.toHaveBeenCalled();
    await alertOncePerEvent('evt-0', emit);
    expect(emit).toHaveBeenCalledTimes(1);
  });
});

describe('alertUnmappedInflow', () => {
  const event = {
    eventId: 'evt-9',
    eventType: 'bank-transfer.inflow.success',
    eventData: { transaction_id: 'txn-9' },
  } as unknown as PiggyvestWebhookEvent;
  const unmapped = new InflowLedgerError('INFLOW_LEDGER_UNMAPPED', 'x');

  it('pages once per provider transaction for an unmapped deposit', async () => {
    resetUnmappedAlertMemoryForTests();
    mockAlert.mockReset().mockResolvedValue(true);
    await alertUnmappedInflow(unmapped, event);
    await alertUnmappedInflow(unmapped, {
      ...event,
      eventId: 'evt-10',
    } as never);
    expect(mockAlert).toHaveBeenCalledTimes(1);
  });

  it('uses the provider transaction as the PostHog operation id', async () => {
    resetUnmappedAlertMemoryForTests();
    mockAlert.mockReset().mockResolvedValue(true);
    await alertUnmappedInflow(unmapped, event);
    expect(mockAlert).toHaveBeenCalledWith('PIGGYVEST_INFLOW_UNMAPPED', {
      eventType: 'bank-transfer.inflow.success',
      operationId: 'txn-9',
    });
  });

  it('falls back to the event id when the transaction id is not a safe identifier', async () => {
    resetUnmappedAlertMemoryForTests();
    mockAlert.mockReset().mockResolvedValue(true);
    await alertUnmappedInflow(unmapped, {
      ...event,
      eventData: { transaction_id: 'bad id with spaces' },
    } as never);
    expect(mockAlert.mock.calls[0]?.[1]).toMatchObject({
      operationId: 'evt-9',
    });
  });

  it('pages again on redelivery when the PostHog send failed', async () => {
    resetUnmappedAlertMemoryForTests();
    mockAlert
      .mockReset()
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue(true);
    await alertUnmappedInflow(unmapped, event);
    await alertUnmappedInflow(unmapped, event);
    await alertUnmappedInflow(unmapped, event);
    await alertUnmappedInflow(unmapped, event);
    expect(mockAlert).toHaveBeenCalledTimes(3);
  });

  it('stays silent for other errors', async () => {
    resetUnmappedAlertMemoryForTests();
    mockAlert.mockReset();
    await alertUnmappedInflow(
      new InflowLedgerError('INFLOW_LEDGER_CONFLICT', 'x'),
      event
    );
    await alertUnmappedInflow(new Error('boom'), event);
    expect(mockAlert).not.toHaveBeenCalled();
  });
});
