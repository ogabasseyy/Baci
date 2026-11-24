import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ save: vi.fn(), clear: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('./chat-follow-up-reminder-save', () => ({
  saveChatFollowUpReminder: mocks.save,
}));
vi.mock('./chat-follow-up-reminder-clear', () => ({
  clearChatFollowUpReminder: mocks.clear,
}));

import { syncChatFollowUpReminder } from './chat-follow-up-reminder-sync';

const client = {} as never;
const base = {
  merchantId: 'c4a70000-0000-4000-8000-0000000000b1',
  conversationId: 7,
  customerName: 'Ada',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.save.mockResolvedValue(true);
  mocks.clear.mockResolvedValue(true);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('syncChatFollowUpReminder', () => {
  it('records one reminder when a follow-up is set', async () => {
    await expect(
      syncChatFollowUpReminder(client, {
        ...base,
        update: { followUpAt: '2026-11-25T09:00:00Z' },
      })
    ).resolves.toBe('saved');

    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save).toHaveBeenCalledWith(client, {
      merchantId: base.merchantId,
      conversationId: 7,
      dueAt: '2026-11-25T09:00:00.000Z',
      customerName: 'Ada',
    });
    expect(mocks.clear).not.toHaveBeenCalled();
  });

  it('replaces the reminder when the follow-up time is changed', async () => {
    await syncChatFollowUpReminder(client, {
      ...base,
      update: { followUpAt: '2026-11-25T09:00:00Z' },
    });
    await syncChatFollowUpReminder(client, {
      ...base,
      update: { followUpAt: '2026-11-26T09:00:00Z' },
    });

    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.save.mock.calls[1][1].dueAt).toBe('2026-11-26T09:00:00.000Z');
  });

  describe('bugfix: two team members changing one follow-up at the same moment', () => {
    it('does not write an older time over a newer one the engine already shows', async () => {
      await expect(
        syncChatFollowUpReminder(client, {
          ...base,
          update: { followUpAt: '2026-11-25T09:00:00Z' },
          observed: {
            status: 'snoozed',
            snoozedUntil: '2026-11-25T10:00:00.000Z',
          },
        })
      ).resolves.toBe('unchanged');
      expect(mocks.save).not.toHaveBeenCalled();
    });

    it('still writes when the engine shows the requested time, even rounded by seconds', async () => {
      await expect(
        syncChatFollowUpReminder(client, {
          ...base,
          update: { followUpAt: '2026-11-25T09:00:00Z' },
          observed: {
            status: 'snoozed',
            snoozedUntil: '2026-11-25T09:00:20.000Z',
          },
        })
      ).resolves.toBe('saved');
    });

    it('does not delete the reminder of a follow-up another member set while this one cleared', async () => {
      await expect(
        syncChatFollowUpReminder(client, {
          ...base,
          update: { followUpAt: null },
          observed: {
            status: 'snoozed',
            followUp: true,
            snoozedUntil: '2026-11-25T10:00:00.000Z',
          },
        })
      ).resolves.toBe('unchanged');
      expect(mocks.clear).not.toHaveBeenCalled();
    });

    it('still deletes when the engine shows the follow-up gone', async () => {
      await expect(
        syncChatFollowUpReminder(client, {
          ...base,
          update: { status: 'resolved' },
          observed: { status: 'resolved', followUp: false },
        })
      ).resolves.toBe('cleared');
    });

    it('still writes when the engine shows no snooze time to compare', async () => {
      await expect(
        syncChatFollowUpReminder(client, {
          ...base,
          update: { followUpAt: '2026-11-25T09:00:00Z' },
          observed: { status: 'snoozed', snoozedUntil: null },
        })
      ).resolves.toBe('saved');
    });
  });

  it('keeps an anonymous visitor name out of the reminder', async () => {
    await syncChatFollowUpReminder(client, {
      ...base,
      customerName: 'withered-sun-554',
      update: { followUpAt: '2026-11-25T09:00:00Z' },
    });
    expect(mocks.save.mock.calls[0][1].customerName).toBe('');
  });

  it.each([
    ['the follow-up is cleared', { followUpAt: null }],
    ['the chat is marked Done', { status: 'resolved' as const }],
    ['the chat is reopened', { status: 'open' as const }],
  ])('removes the reminder when %s', async (_label, update) => {
    await expect(
      syncChatFollowUpReminder(client, { ...base, update })
    ).resolves.toBe('cleared');
    expect(mocks.clear).toHaveBeenCalledWith(client, {
      merchantId: base.merchantId,
      conversationId: 7,
    });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('leaves the reminder alone for a priority or tag change', async () => {
    await expect(
      syncChatFollowUpReminder(client, {
        ...base,
        update: { priority: 'high', addTags: ['vip'] },
      })
    ).resolves.toBe('unchanged');
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.clear).not.toHaveBeenCalled();
  });

  it('reports a failed write without throwing or logging customer text', async () => {
    mocks.save.mockResolvedValue(false);
    await expect(
      syncChatFollowUpReminder(client, {
        ...base,
        update: { followUpAt: '2026-11-25T09:00:00Z' },
      })
    ).resolves.toBe('failed');
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(
      'Ada'
    );
  });

  it('survives a store that throws', async () => {
    mocks.clear.mockRejectedValue(new Error('network'));
    await expect(
      syncChatFollowUpReminder(client, {
        ...base,
        update: { followUpAt: null },
      })
    ).resolves.toBe('failed');
  });
});
