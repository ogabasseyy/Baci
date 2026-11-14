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

import type { PiggyvestIntakeClient } from '@/lib/piggyvest/intake-client.types';
import { processVerifiedDelivery } from './process-delivery';

const client = {
  name: 'intake-client',
} as unknown as PiggyvestIntakeClient;
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dispatch.mockResolvedValue(null);
  mocks.record.mockResolvedValue('new');
  mocks.process.mockResolvedValue('processed');
  mocks.quarantine.mockImplementation(async () =>
    Response.json({ received: true, quarantined: true })
  );
});

describe('primary dispatch environment', () => {
  it('uses the supplied environment and leaves the global environment unchanged', async () => {
    const original = process.env.PIGGYVEST_PRIMARY_INTAKE_TEST;
    process.env.PIGGYVEST_PRIMARY_INTAKE_TEST = 'global';
    const workerEnv: NodeJS.ProcessEnv = {
      NODE_ENV: 'test',
      PIGGYVEST_PRIMARY_INTAKE_TEST: 'worker',
    };
    try {
      await processVerifiedDelivery(
        {
          rawBody: Buffer.from(JSON.stringify(restriction)),
          signature,
          matchedSecret: 'matched-secret',
          families: ['legacy'],
        },
        { createClient, getPiggyvestConfig, env: workerEnv }
      );
      expect(mocks.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ env: workerEnv })
      );
      expect(process.env.PIGGYVEST_PRIMARY_INTAKE_TEST).toBe('global');
    } finally {
      if (original === undefined)
        delete process.env.PIGGYVEST_PRIMARY_INTAKE_TEST;
      else process.env.PIGGYVEST_PRIMARY_INTAKE_TEST = original;
    }
  });
});
