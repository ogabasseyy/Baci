import { describe, expect, it, vi } from 'vitest';
import { createPiggyvestPostgresInbox } from './postgres-inbox';

const integrationId = '00000000-0000-4000-8000-000000000001';
const inboxId = '00000000-0000-4000-8000-000000000002';
const input = {
  integrationId,
  eventId: "synthetic-'event",
  rawPayload: new TextEncoder().encode('{}'),
};

describe('createPiggyvestPostgresInbox', () => {
  it.each([
    'accepted',
    'duplicate',
    'conflict',
  ])('preserves committed database outcome %s', async (outcome) => {
    const execute = vi.fn(async () => ({
      rows: [{ inbox_id: inboxId, outcome }],
    }));
    const inbox = createPiggyvestPostgresInbox({ integrationId, execute });
    expect(await inbox.enqueue(input)).toBe(outcome);
    expect(execute).toHaveBeenCalledExactlyOnceWith(
      'SELECT inbox_id, outcome FROM piggyvest_staging.enqueue_inbox($1::uuid, $2::text, $3::bytea)',
      [integrationId, input.eventId, Buffer.from(input.rawPayload)]
    );
  });

  it('rejects an integration different from the bound server configuration before SQL', async () => {
    const execute = vi.fn();
    const inbox = createPiggyvestPostgresInbox({ integrationId, execute });
    await expect(
      inbox.enqueue({ ...input, integrationId: inboxId })
    ).rejects.toThrow('PiggyVest inbox unavailable');
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    { rows: [] },
    { rows: [{ inbox_id: inboxId, outcome: 'processed' }] },
    {
      rows: [
        { inbox_id: inboxId, outcome: 'accepted' },
        { inbox_id: inboxId, outcome: 'duplicate' },
      ],
    },
  ])('rejects invalid database responses', async (response) => {
    const inbox = createPiggyvestPostgresInbox({
      integrationId,
      execute: async () => response,
    });
    await expect(inbox.enqueue(input)).rejects.toThrow(
      'PiggyVest inbox unavailable'
    );
  });

  it('redacts database failures without retrying an uncertain commit', async () => {
    const execute = vi.fn(async () => {
      throw new Error('sensitive SQL detail');
    });
    const inbox = createPiggyvestPostgresInbox({ integrationId, execute });
    await expect(inbox.enqueue(input)).rejects.toThrow(
      /^PiggyVest inbox unavailable$/
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('copies bytes before an executor can observe caller mutation', async () => {
    const request = { ...input, rawPayload: new TextEncoder().encode('{}') };
    const execute = async (
      _statement: string,
      parameters: readonly unknown[]
    ) => {
      request.rawPayload.fill(42);
      await Promise.resolve();
      expect(parameters[2]).toEqual(Buffer.from('{}'));
      return { rows: [{ inbox_id: inboxId, outcome: 'accepted' }] };
    };
    expect(
      await createPiggyvestPostgresInbox({ integrationId, execute }).enqueue(
        request
      )
    ).toBe('accepted');
  });
});
