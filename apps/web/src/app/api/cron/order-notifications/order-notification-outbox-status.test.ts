import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

import {
  markOutboxNotificationSent,
  OutboxStatusUpdateError,
  updateOutboxStatus,
} from './order-notification-outbox-status';

const row = { id: 'outbox-1', claim_owner: 'worker-1' };

function createBuilder() {
  const maybeSingle = vi.fn();
  const select = vi.fn();
  const builder = {
    match: vi.fn(() => builder),
    maybeSingle,
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
