import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { persistLegacyPlatformEvent } from './persist-legacy-platform-event';

function client(error: { code: string; message: string } | null) {
  const insert = vi.fn().mockResolvedValue({ error });
  return {
    insert,
    supabase: { from: () => ({ insert }) } as unknown as SupabaseClient,
  };
}
const input = {
  eventType: 'landing_page_view' as const,
  eventId: 'event-1',
  eventTimestamp: '2026-09-27T00:00:00.000Z',
};
describe('insert-only platform persistence', () => {
  it('inserts without requiring a SELECT RLS policy', async () => {
    const db = client(null);
    expect(await persistLegacyPlatformEvent(db.supabase, input)).toMatchObject({
      error: null,
      duplicate: false,
    });
    expect(db.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_id: 'event-1',
        event_type: 'landing_page_view',
      })
    );
  });
  it('accepts only the known event-identity duplicate', async () => {
    const db = client({
      code: '23505',
      message:
        'duplicate key value violates unique constraint "platform_events_type_event_id_uidx"',
    });
    expect(await persistLegacyPlatformEvent(db.supabase, input)).toEqual({
      error: null,
      duplicate: true,
    });
  });
  it.each([
    '42501',
    '23503',
    '23505',
  ])('does not hide unrelated %s errors', async (code) => {
    const error = { code, message: 'different constraint or policy' };
    expect(
      (await persistLegacyPlatformEvent(client(error).supabase, input)).error
    ).toEqual(error);
  });
});
