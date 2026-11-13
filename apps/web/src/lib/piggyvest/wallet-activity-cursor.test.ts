import { describe, expect, it } from 'vitest';
import { walletActivityCursor } from './wallet-activity-cursor';

describe('walletActivityCursor', () => {
  const row = {
    occurred_at: '2026-11-13T10:00:00.123456+00:00',
    id: '00000000-0000-4000-8000-000000000001',
  };

  it('round-trips the last row as an opaque url-safe string', () => {
    const cursor = walletActivityCursor.encode(row);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(walletActivityCursor.decode(cursor)).toEqual({
      beforeAt: row.occurred_at,
      beforeId: row.id,
    });
  });

  it.each([
    'not-base64-json',
    Buffer.from('{}').toString('base64url'),
    Buffer.from('["2026-11-13T10:00:00Z"]').toString('base64url'),
    Buffer.from(
      '["yesterday","00000000-0000-4000-8000-000000000001"]'
    ).toString('base64url'),
    Buffer.from(`["${row.occurred_at}","not-a-uuid"]`).toString('base64url'),
  ])('returns null for a tampered cursor (%s)', (cursor) => {
    expect(walletActivityCursor.decode(cursor)).toBeNull();
  });
});
