import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

import {
  canonicalizeOutboxMetadataForGuard,
  markManualOutboxNotificationSent,
  markOutboxNotificationSent,
  OutboxDispatchResetError,
  OutboxStatusUpdateError,
  updateOutboxStatus,
} from './order-notification-outbox-status';

const row = { id: 'outbox-1', claim_owner: 'worker-1' };

function createBuilder() {
  const maybeSingle = vi.fn();
  const select = vi.fn();
  const builder = {
    eq: vi.fn(() => builder),
    is: vi.fn(() => builder),
    match: vi.fn(() => builder),
    maybeSingle,
    not: vi.fn(() => builder),
    select,
    update: vi.fn(() => builder),
  };
  select.mockImplementation(() => builder);
  return { builder, maybeSingle, select };
}

describe('order notification outbox status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('merges the message id into the live metadata instead of a stale copy', async () => {
    const { builder } = createBuilder();
    builder.maybeSingle
      .mockResolvedValueOnce({
        data: {
          id: row.id,
          metadata: { source: 'manual_order_document', extra: 'live' },
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: { id: row.id }, error: null });
    const supabase = { from: vi.fn(() => builder) };

    await markOutboxNotificationSent(supabase as never, row, 'message-1');

    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'sent',
        metadata: {
          source: 'manual_order_document',
          extra: 'live',
          message_id: 'message-1',
        },
      })
    );
  });

  it('wraps a failed live re-read so the send terminalizes instead of retrying', async () => {
    const { builder } = createBuilder();
    builder.maybeSingle.mockRejectedValueOnce(
      new Error('database connection reset')
    );
    const supabase = { from: vi.fn(() => builder) };

    await expect(
      markOutboxNotificationSent(supabase as never, row, 'message-1')
    ).rejects.toBeInstanceOf(OutboxStatusUpdateError);
    expect(builder.update).not.toHaveBeenCalled();
  });

  it('guards the manual sent merge on the re-read metadata value', async () => {
    const { builder } = createBuilder();
    const live = { sent_document_kind: 'receipt' };
    builder.maybeSingle
      .mockResolvedValueOnce({
        data: {
          id: row.id,
          metadata: live,
          updated_at: '2026-10-03T00:00:00Z',
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: { id: row.id }, error: null });
    const supabase = { from: vi.fn(() => builder) };

    await markManualOutboxNotificationSent(supabase as never, row, 'msg-1');

    expect(builder.eq).toHaveBeenCalledWith('metadata', JSON.stringify(live));
    expect(builder.eq).toHaveBeenCalledWith(
      'updated_at',
      '2026-10-03T00:00:00Z'
    );
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { sent_document_kind: 'receipt', message_id: 'msg-1' },
      })
    );
  });

  it('retries the merge when metadata moves under the guard', async () => {
    const { builder } = createBuilder();
    builder.maybeSingle
      .mockResolvedValueOnce({
        data: {
          id: row.id,
          metadata: { sent_document_kind: 'receipt' },
          updated_at: '2026-10-03T00:00:00Z',
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: {
          status: 'processing',
          locked_by: 'worker-1',
          dispatch_started_at: '2026-10-03T00:00:00Z',
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          id: row.id,
          metadata: { sent_document_kind: 'receipt', late: 'key' },
          updated_at: '2026-10-03T00:00:01Z',
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: { id: row.id }, error: null });
    const supabase = { from: vi.fn(() => builder) };

    await markManualOutboxNotificationSent(supabase as never, row, 'msg-1');

    expect(builder.update).toHaveBeenCalledTimes(2);
    expect(builder.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        metadata: {
          sent_document_kind: 'receipt',
          late: 'key',
          message_id: 'msg-1',
        },
      })
    );
  });

  it('still surfaces a dispatch reset instead of retrying the merge', async () => {
    const { builder } = createBuilder();
    builder.maybeSingle
      .mockResolvedValueOnce({
        data: { id: row.id, metadata: {} },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: {
          status: 'processing',
          locked_by: 'worker-1',
          dispatch_started_at: null,
        },
        error: null,
      });
    const supabase = { from: vi.fn(() => builder) };

    await expect(
      markManualOutboxNotificationSent(supabase as never, row, 'msg-1')
    ).rejects.toBeInstanceOf(OutboxDispatchResetError);
    expect(builder.update).toHaveBeenCalledTimes(1);
  });

  it('matches null metadata with an is-null guard', async () => {
    const { builder } = createBuilder();
    builder.maybeSingle
      .mockResolvedValueOnce({
        data: { id: row.id, metadata: null },
        error: null,
      })
      .mockResolvedValueOnce({ data: { id: row.id }, error: null });
    const supabase = { from: vi.fn(() => builder) };

    await markManualOutboxNotificationSent(supabase as never, row, 'msg-1');

    expect(builder.is).toHaveBeenCalledWith('metadata', null);
    expect(builder.eq).not.toHaveBeenCalled();
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { message_id: 'msg-1' } })
    );
  });

  it('canonicalizes guard metadata independent of key-insertion order', () => {
    expect(
      canonicalizeOutboxMetadataForGuard({ b: 2, a: { d: 4, c: 3 } })
    ).toBe('{"a":{"c":3,"d":4},"b":2}');
    // Array order is significant and preserved; undefined object values
    // serialize like JSON.stringify (dropped) instead of throwing.
    expect(
      canonicalizeOutboxMetadataForGuard({ list: [3, 1], skip: undefined })
    ).toBe('{"list":[3,1]}');
    expect(canonicalizeOutboxMetadataForGuard(null)).toBe('null');
    expect(canonicalizeOutboxMetadataForGuard('x')).toBe('"x"');
  });

  it('guards the non-manual sent merge on the re-read row version', async () => {
    const { builder } = createBuilder();
    builder.maybeSingle
      .mockResolvedValueOnce({
        data: {
          id: row.id,
          metadata: { b_key: 'late', a_key: 'early' },
          updated_at: '2026-10-03T00:00:00Z',
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: { id: row.id }, error: null });
    const supabase = { from: vi.fn(() => builder) };

    await markOutboxNotificationSent(supabase as never, row, 'message-1');

    expect(builder.eq).toHaveBeenCalledWith(
      'metadata',
      '{"a_key":"early","b_key":"late"}'
    );
    expect(builder.eq).toHaveBeenCalledWith(
      'updated_at',
      '2026-10-03T00:00:00Z'
    );
  });

  it('leaves terminal writes unguarded: they set full scalar values', async () => {
    const { builder } = createBuilder();
    builder.maybeSingle.mockResolvedValueOnce({
      data: { id: row.id },
      error: null,
    });
    const supabase = { from: vi.fn(() => builder) };

    await updateOutboxStatus(supabase as never, row, { status: 'skipped' });

    expect(builder.eq).not.toHaveBeenCalled();
    expect(builder.is).not.toHaveBeenCalled();
  });

  it('wraps a failed status write with the outbox id', async () => {
    const { builder } = createBuilder();
    builder.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'write failed' },
    });
    const supabase = { from: vi.fn(() => builder) };

    const failure = await updateOutboxStatus(supabase as never, row, {
      status: 'sent',
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(OutboxStatusUpdateError);
    expect((failure as OutboxStatusUpdateError).outboxId).toBe(row.id);
  });
});
