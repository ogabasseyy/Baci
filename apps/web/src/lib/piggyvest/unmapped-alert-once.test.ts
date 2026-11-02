import { describe, expect, it, vi } from 'vitest';
import type { PiggyvestWebhookEvent } from '@/schemas/piggyvest/events';
import { InflowLedgerError } from './inflow-ledger';
import {
  alertOncePerEvent,
  alertUnmappedInflow,
  resetUnmappedAlertMemoryForTests,
} from './unmapped-alert-once';

const mockAlert = vi.hoisted(() => vi.fn());
vi.mock('./webhook-alerts', () => ({ emitPiggyvestWebhookAlert: mockAlert }));

describe('alertOncePerEvent', () => {
  it('raises the alert once for repeated deliveries of the same event', () => {
    resetUnmappedAlertMemoryForTests();
    const emit = vi.fn();
    alertOncePerEvent('evt-1', emit);
    alertOncePerEvent('evt-1', emit);
    alertOncePerEvent('evt-1', emit);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('raises a separate alert for a different event', () => {
    resetUnmappedAlertMemoryForTests();
    const emit = vi.fn();
    alertOncePerEvent('evt-1', emit);
    alertOncePerEvent('evt-2', emit);
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it('tries again on the next delivery when the alert itself failed', () => {
    resetUnmappedAlertMemoryForTests();
    const emit = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('alert down');
      })
      .mockImplementation(() => undefined);
    expect(() => alertOncePerEvent('evt-1', emit)).toThrow('alert down');
    alertOncePerEvent('evt-1', emit);
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it('forgets the oldest events once the memory is full', () => {
    resetUnmappedAlertMemoryForTests();
    const emit = vi.fn();
    for (let i = 0; i < 600; i += 1) alertOncePerEvent(`evt-${i}`, emit);
    emit.mockClear();
    alertOncePerEvent('evt-599', emit);
    expect(emit).not.toHaveBeenCalled();
    alertOncePerEvent('evt-0', emit);
    expect(emit).toHaveBeenCalledTimes(1);
  });
});

describe('alertUnmappedInflow', () => {
  const event = {
    eventId: 'evt-9',
    eventType: 'bank-transfer.inflow.success',
    eventData: { transaction_id: 'txn-9' },
  } as unknown as PiggyvestWebhookEvent;

  it('pages once per provider transaction for an unmapped deposit', () => {
    resetUnmappedAlertMemoryForTests();
    mockAlert.mockClear();
    const err = new InflowLedgerError('INFLOW_LEDGER_UNMAPPED', 'x');
    alertUnmappedInflow(err, event);
    alertUnmappedInflow(err, { ...event, eventId: 'evt-10' } as never);
    expect(mockAlert).toHaveBeenCalledTimes(1);
  });

  it('stays silent for other errors', () => {
    resetUnmappedAlertMemoryForTests();
    mockAlert.mockClear();
    alertUnmappedInflow(
      new InflowLedgerError('INFLOW_LEDGER_CONFLICT', 'x'),
      event
    );
    alertUnmappedInflow(new Error('boom'), event);
    expect(mockAlert).not.toHaveBeenCalled();
  });
});
