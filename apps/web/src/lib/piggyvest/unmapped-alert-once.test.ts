import { describe, expect, it, vi } from 'vitest';
import type { PiggyvestWebhookEvent } from '@/schemas/piggyvest/events';
import { InflowLedgerError } from './inflow-ledger';
import {
  alertOncePerEvent,
  alertUnmappedInflow,
  resetUnmappedAlertMemoryForTests,
} from './unmapped-alert-once';

const mockLog = vi.hoisted(() => vi.fn());
const mockSend = vi.hoisted(() => vi.fn());
vi.mock('./webhook-alerts', () => ({
  logPiggyvestWebhookAlert: mockLog,
  sendPiggyvestWebhookAlertDelivered: mockSend,
}));

function alertWith(send: () => Promise<boolean>) {
  return { log: vi.fn(), send: vi.fn(send) };
}

describe('alertOncePerEvent', () => {
  it('writes the log line once and sends once for repeated deliveries', async () => {
    resetUnmappedAlertMemoryForTests();
    const alert = alertWith(async () => true);
    await alertOncePerEvent('evt-1', alert);
    await alertOncePerEvent('evt-1', alert);
    await alertOncePerEvent('evt-1', alert);
    expect(alert.log).toHaveBeenCalledTimes(1);
    expect(alert.send).toHaveBeenCalledTimes(1);
  });

  it('pages a different key separately', async () => {
    resetUnmappedAlertMemoryForTests();
    const alert = alertWith(async () => true);
    await alertOncePerEvent('evt-1', alert);
    await alertOncePerEvent('evt-2', alert);
    expect(alert.log).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['resolves false', () => Promise.resolve(false)],
    ['rejects', () => Promise.reject(new Error('posthog down'))],
  ])('retries only the PostHog send, never the log line, when the send %s', async (_n, fail) => {
    resetUnmappedAlertMemoryForTests();
    const log = vi.fn();
    const send = vi
      .fn<() => Promise<boolean>>()
      .mockImplementationOnce(fail)
      .mockResolvedValue(true);
    await alertOncePerEvent('evt-1', { log, send });
    await alertOncePerEvent('evt-1', { log, send });
    await alertOncePerEvent('evt-1', { log, send });
    expect(log).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('keeps retrying PostHog on each redelivery while it stays down, with one log line', async () => {
    resetUnmappedAlertMemoryForTests();
    const alert = alertWith(async () => false);
    for (let i = 0; i < 4; i += 1) await alertOncePerEvent('evt-1', alert);
    expect(alert.log).toHaveBeenCalledTimes(1);
    expect(alert.send).toHaveBeenCalledTimes(4);
  });

  it('does not double-page concurrent redeliveries', async () => {
    resetUnmappedAlertMemoryForTests();
    let release: (v: boolean) => void = () => undefined;
    const alert = alertWith(() => new Promise<boolean>((r) => (release = r)));
    const first = alertOncePerEvent('evt-1', alert);
    const second = alertOncePerEvent('evt-1', alert);
    release(true);
    await Promise.all([first, second]);
    expect(alert.log).toHaveBeenCalledTimes(1);
    expect(alert.send).toHaveBeenCalledTimes(1);
  });

  it('forgets the oldest keys once the memory is full', async () => {
    resetUnmappedAlertMemoryForTests();
    const alert = alertWith(async () => true);
    for (let i = 0; i < 600; i += 1) await alertOncePerEvent(`evt-${i}`, alert);
    alert.log.mockClear();
    await alertOncePerEvent('evt-599', alert);
    expect(alert.log).not.toHaveBeenCalled();
    await alertOncePerEvent('evt-0', alert);
    expect(alert.log).toHaveBeenCalledTimes(1);
  });
});

describe('alertUnmappedInflow', () => {
  const event = {
    eventId: 'evt-9',
    eventType: 'bank-transfer.inflow.success',
    eventData: { transaction_id: 'txn-9' },
  } as unknown as PiggyvestWebhookEvent;
  const unmapped = new InflowLedgerError('INFLOW_LEDGER_UNMAPPED', 'x');

  function reset(sendResult: boolean | Error = true) {
    resetUnmappedAlertMemoryForTests();
    mockLog.mockReset();
    mockSend.mockReset();
    if (sendResult instanceof Error) mockSend.mockRejectedValue(sendResult);
    else mockSend.mockResolvedValue(sendResult);
  }

  it('writes exactly one log line on the first-ever delivery', async () => {
    reset();
    await alertUnmappedInflow(unmapped, event);
    expect(mockLog).toHaveBeenCalledExactlyOnceWith(
      'PIGGYVEST_INFLOW_UNMAPPED',
      { eventType: 'bank-transfer.inflow.success', operationId: 'txn-9' }
    );
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('pages once per provider transaction even under a new event id', async () => {
    reset();
    await alertUnmappedInflow(unmapped, event);
    await alertUnmappedInflow(unmapped, {
      ...event,
      eventId: 'evt-10',
    } as never);
    expect(mockLog).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('adds no second log line when PostHog rejects and the deposit is redelivered', async () => {
    reset(new Error('down'));
    await alertUnmappedInflow(unmapped, event);
    await alertUnmappedInflow(unmapped, event);
    expect(mockLog).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('derives a stable safe PostHog id from an unsafe transaction id, not the event id', async () => {
    reset();
    const unsafe = {
      ...event,
      eventData: { transaction_id: 'bad id with spaces' },
    } as never;
    await alertUnmappedInflow(unmapped, unsafe);
    await alertUnmappedInflow(unmapped, {
      ...(unsafe as object),
      eventId: 'evt-77',
    } as never);
    const id = (mockLog.mock.calls[0]?.[1] as { operationId: string })
      .operationId;
    expect(id).toMatch(/^txn_[0-9a-f]{32}$/);
    expect(id).not.toContain('evt-');
    expect(mockLog).toHaveBeenCalledTimes(1);
  });

  it('uses the event id for deposits without a transaction', async () => {
    reset();
    await alertUnmappedInflow(unmapped, {
      eventId: 'evt-5',
      eventType: 'other.event',
      eventData: {},
    } as never);
    expect(mockLog.mock.calls[0]?.[1]).toMatchObject({ operationId: 'evt-5' });
  });

  it.each([
    undefined,
    null,
    '',
  ])('falls back to the event id when the inflow transaction id is %p', async (transactionId) => {
    reset();
    await alertUnmappedInflow(unmapped, {
      ...event,
      eventId: 'evt-a',
      eventData: { transaction_id: transactionId },
    } as never);
    await alertUnmappedInflow(unmapped, {
      ...event,
      eventId: 'evt-b',
      eventData: { transaction_id: transactionId },
    } as never);
    // Two distinct deposits without a usable id must not collapse into one.
    expect(mockLog).toHaveBeenCalledTimes(2);
    expect(mockLog.mock.calls[0]?.[1]).toMatchObject({ operationId: 'evt-a' });
  });

  it('stays silent for other errors', async () => {
    reset();
    await alertUnmappedInflow(
      new InflowLedgerError('INFLOW_LEDGER_CONFLICT', 'x'),
      event
    );
    await alertUnmappedInflow(new Error('boom'), event);
    expect(mockLog).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });
});
