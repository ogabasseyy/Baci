import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  quarantine: vi.fn(),
  record: vi.fn(),
  process: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('./primary-webhook-dispatch', () => ({
  dispatchPrimaryPiggyvestIntake: (...args: unknown[]) =>
    mocks.dispatch(...args),
}));
vi.mock('./quarantine-and-ack', () => ({
  quarantineAndAck: (...args: unknown[]) => mocks.quarantine(...args),
}));
vi.mock('./record-input', () => ({
  toRecordInput: (event: { eventId: string }) => ({ eventId: event.eventId }),
}));
vi.mock('@/lib/piggyvest/webhook-inbox', () => ({
  recordPiggyvestEvent: (...args: unknown[]) => mocks.record(...args),
}));
vi.mock('@/lib/piggyvest/webhook-processor', () => ({
  processPiggyvestEvent: (...args: unknown[]) => mocks.process(...args),
}));

import type { PiggyvestIntakeServiceClient } from '@/lib/supabase/service';
import { processVerifiedDelivery } from './process-delivery';

const client = {
  name: 'intake-client',
} as unknown as PiggyvestIntakeServiceClient;
const config = { baseUrl: 'https://provider.example', token: 'synthetic' };
const signature = 'ab'.repeat(64);

const restriction = {
  eventId: 'evt-restriction-1',
  eventType: 'restriction-created.success',
  eventCategory: 'restriction',
  customer_id: 'customer-1',
  eventData: {},
  pvb_wallet: 'wallet-1',
};

const createClient = vi.fn(() => client);
const getPiggyvestConfig = vi.fn(() => config);

function run(
  body: string | object,
  families: ('legacy' | 'bank' | 'custody' | 'interest')[] = ['legacy']
) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return processVerifiedDelivery(
    {
      rawBody: Buffer.from(text),
      signature,
      matchedSecret: 'matched-secret',
      families,
    },
    { createClient, getPiggyvestConfig }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dispatch.mockResolvedValue(null);
  mocks.record.mockResolvedValue('new');
  mocks.process.mockResolvedValue('processed');
  mocks.quarantine.mockImplementation(async () =>
    Response.json({ received: true, quarantined: true })
  );
});

describe('quarantine paths', () => {
  it('quarantines an unparseable body without dispatching or processing', async () => {
    const response = await run('<<not json>>');

    expect(await response.json()).toEqual({
      received: true,
      quarantined: true,
    });
    expect(mocks.quarantine).toHaveBeenCalledWith(
      Buffer.from('<<not json>>'),
      'unparseable',
      {},
      null,
      createClient
    );
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(mocks.process).not.toHaveBeenCalled();
  });

  it('quarantines invalid UTF-8 instead of replacing bytes', async () => {
    await processVerifiedDelivery(
      {
        rawBody: Buffer.from([0x7b, 0xff, 0x7d]),
        signature,
        matchedSecret: 'm',
        families: ['legacy'],
      },
      { createClient, getPiggyvestConfig }
    );
    expect(mocks.quarantine.mock.calls[0]?.[1]).toBe('unparseable');
  });

  it('quarantines an unknown event shape, carrying only a valid correlation', async () => {
    await run({ eventId: 'evt-9', eventType: 'wallet.new.success', extra: 1 });
    expect(mocks.quarantine.mock.calls[0]?.slice(1, 4)).toEqual([
      'unknown-event',
      { eventId: 'evt-9', eventType: 'wallet.new.success' },
      null,
    ]);

    await run({ eventId: 42, eventType: ['x'] });
    expect(mocks.quarantine.mock.calls[1]?.[2]).toEqual({});
  });

  it('quarantines a primary-intake conflict with the event identity and redacted detail', async () => {
    mocks.dispatch.mockResolvedValue('conflict');

    await run(restriction);

    const [, reason, correlation, detail] =
      mocks.quarantine.mock.calls[0] ?? [];
    expect(reason).toBe('conflict');
    expect(correlation).toEqual({
      eventId: restriction.eventId,
      eventType: restriction.eventType,
    });
    expect(detail).toMatchObject({ eventId: restriction.eventId });
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('never legacy-processes a delivery signed only by a primary key family', async () => {
    await run(restriction, ['interest']);

    expect(mocks.quarantine.mock.calls[0]?.[1]).toBe('key-family');
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.process).not.toHaveBeenCalled();
  });
});

describe('primary and legacy processing', () => {
  it('hands the verified bytes, signature, secret and families to the primary intakes', async () => {
    const claimed = Response.json({ received: true, interestQueued: true });
    mocks.dispatch.mockResolvedValue(claimed);

    const response = await run(restriction, ['legacy', 'interest']);

    expect(response).toBe(claimed);
    expect(mocks.dispatch).toHaveBeenCalledWith({
      rawBody: Buffer.from(JSON.stringify(restriction)),
      signature,
      matchedSecret: 'matched-secret',
      event: expect.objectContaining({ eventId: restriction.eventId }),
      families: ['legacy', 'interest'],
    });
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('forwards the key scope so a replayed delivery can use replay-only archived keys', async () => {
    await processVerifiedDelivery(
      {
        rawBody: Buffer.from(JSON.stringify(restriction)),
        signature,
        matchedSecret: 'matched-secret',
        families: ['bank'],
        keyScope: 'replay',
      },
      { createClient, getPiggyvestConfig }
    );
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ keyScope: 'replay', families: ['bank'] })
    );

    mocks.dispatch.mockClear();
    await run(restriction);
    expect(mocks.dispatch.mock.calls[0]?.[0].keyScope).toBeUndefined();
  });

  it.each([
    ['new', false],
    ['duplicate', true],
  ])('records then processes a %s legacy delivery', async (outcome, duplicate) => {
    mocks.record.mockResolvedValue(outcome);

    const response = await run(restriction);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, duplicate });
    expect(mocks.process).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ eventId: restriction.eventId }),
      { piggyvestConfig: config }
    );
  });

  it('reads the provider config only when it reaches processing', async () => {
    mocks.dispatch.mockResolvedValue(Response.json({ received: true }));
    await run(restriction);
    expect(getPiggyvestConfig).not.toHaveBeenCalled();
  });

  it('quarantines a same-identity conflict from the inbox and does not process it', async () => {
    mocks.record.mockResolvedValue('conflict');

    await run(restriction);

    expect(mocks.quarantine.mock.calls[0]?.[1]).toBe('conflict');
    expect(mocks.process).not.toHaveBeenCalled();
  });

  it('acknowledges deferred processing as durable backlog', async () => {
    mocks.process.mockResolvedValue('deferred');
    mocks.record.mockResolvedValue('duplicate');

    const response = await run(restriction);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      received: true,
      deferred: true,
      duplicate: true,
    });
  });

  it.each([
    [
      'dispatch',
      () => mocks.dispatch.mockRejectedValue(new Error('db-host-1 down')),
    ],
    [
      'record',
      () => mocks.record.mockRejectedValue(new Error('db-host-1 down')),
    ],
    [
      'process',
      () => mocks.process.mockRejectedValue(new Error('db-host-1 down')),
    ],
    [
      'config',
      () =>
        getPiggyvestConfig.mockImplementationOnce(() => {
          throw new Error('db-host-1 down');
        }),
    ],
  ])('reports an incomplete result (503, no internals) when %s throws', async (_stage, arrange) => {
    arrange();

    const response = await run(restriction);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Event intake unavailable',
      code: 'PIGGYVEST_INBOX_ERROR',
    });
  });
});
