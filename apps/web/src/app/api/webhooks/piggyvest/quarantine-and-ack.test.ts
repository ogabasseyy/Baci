import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  record: vi.fn(),
  client: { brand: 'test-intake-client' },
}));
vi.mock('@/lib/piggyvest/event-quarantine', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/piggyvest/event-quarantine')>();
  return { ...actual, recordQuarantineEvent: mocks.record };
});

import { quarantineAndAck } from './quarantine-and-ack';

const rawBody = Buffer.from('{"event":"synthetic"}');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.record.mockResolvedValue('recorded');
});

it('acks quarantined receipt after the durable write', async () => {
  const response = await quarantineAndAck(
    rawBody,
    'key-family',
    { eventId: 'event-1', eventType: 'restriction-created.success' },
    { walletId: 'wallet-1' },
    () => mocks.client as never
  );

  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.json()).toEqual({
    received: true,
    quarantined: true,
  });
  expect(mocks.record).toHaveBeenCalledWith(mocks.client, {
    bodyDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    reason: 'key-family',
    eventId: 'event-1',
    eventType: 'restriction-created.success',
    detail: { walletId: 'wallet-1' },
  });
});

it('returns 503 without receipt when the quarantine write fails', async () => {
  mocks.record.mockRejectedValue(new Error('storage unavailable'));

  const response = await quarantineAndAck(
    rawBody,
    'conflict',
    {},
    null,
    () => mocks.client as never
  );

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: 'Event intake unavailable',
    code: 'PIGGYVEST_INBOX_ERROR',
  });
});
