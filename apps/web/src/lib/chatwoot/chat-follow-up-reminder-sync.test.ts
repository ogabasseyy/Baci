import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  clear: vi.fn(),
  version: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('./chat-follow-up-reminder-save', () => ({
  saveChatFollowUpReminder: mocks.save,
}));
vi.mock('./chat-follow-up-reminder-clear', () => ({
  clearChatFollowUpReminder: mocks.clear,
}));
vi.mock('./chat-follow-up-reminder-version', () => ({
  readChatFollowUpReminderVersion: mocks.version,
}));

import { syncChatFollowUpReminder } from './chat-follow-up-reminder-sync';

const client = {} as never;
const chat = {
  merchantId: 'c4a70000-0000-4000-8000-0000000000b1',
  conversationId: 7,
};
const recheck = vi.fn();
const read = (revision: string) => ({
  revision,
  dueAt: '2026-11-25T08:00:00.000Z',
});
const base = { ...chat, customerName: 'Ada', seen: read('rev-1'), recheck };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.save.mockResolvedValue('done');
  mocks.clear.mockResolvedValue('done');
  mocks.version.mockResolvedValue(read('rev-2'));
  recheck.mockResolvedValue({ status: 'open', followUp: false });
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
      ...chat,
      version: 'rev-1',
      dueAt: '2026-11-25T09:00:00.000Z',
      customerName: 'Ada',
    });
    expect(mocks.clear).not.toHaveBeenCalled();
    // Nothing competed, so neither the reminder nor the chat is read again.
    expect(mocks.version).not.toHaveBeenCalled();
    expect(recheck).not.toHaveBeenCalled();
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
      ...chat,
      version: 'rev-1',
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
    mocks.save.mockResolvedValue('failed');
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

describe('syncChatFollowUpReminder when the reminder changed meanwhile', () => {
  const nine = '2026-11-25T09:00:00Z';
  const set = (from: { seen?: typeof base.seen } = { seen: base.seen }) =>
    syncChatFollowUpReminder(client, {
      ...base,
      seen: from.seen,
      update: { followUpAt: nine },
    });
  const showsSnooze = (snoozedUntil: string) =>
    recheck.mockResolvedValue({
      status: 'snoozed',
      followUp: true,
      snoozedUntil,
    });

  it('reads the reminder, then the chat, and writes over the new version', async () => {
    mocks.save.mockResolvedValueOnce('conflict');
    showsSnooze(nine);

    await expect(set()).resolves.toBe('saved');

    expect(mocks.save.mock.calls[1][1].version).toBe('rev-2');
    expect(mocks.version.mock.invocationCallOrder[0]).toBeLessThan(
      recheck.mock.invocationCallOrder[0]
    );
  });

  it('stands down when the chat now shows another follow-up', async () => {
    mocks.save.mockResolvedValueOnce('conflict');
    showsSnooze('2026-11-25T10:00:00.000Z');

    await expect(set()).resolves.toBe('unchanged');
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'the chat cannot be read again',
      () => recheck.mockResolvedValue(undefined),
    ],
    [
      'the reminder cannot be read again',
      () => mocks.version.mockResolvedValue(undefined),
    ],
  ])('writes nothing more when %s', async (_label, arrange) => {
    mocks.save.mockResolvedValueOnce('conflict');
    showsSnooze(nine);
    arrange();

    await expect(set()).resolves.toBe('failed');
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });

  it('gives up after three writes on a chat that keeps changing', async () => {
    mocks.save.mockResolvedValue('conflict');
    showsSnooze(nine);

    await expect(set()).resolves.toBe('failed');
    expect(mocks.save).toHaveBeenCalledTimes(3);
  });

  it('reads both first when the reminder could not be read before the change', async () => {
    showsSnooze(nine);

    await expect(set({})).resolves.toBe('saved');
    expect(mocks.save.mock.calls[0][1].version).toBe('rev-2');
    expect(recheck).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['no snooze time to compare', null],
    ['a time closer to the recorded one', '2026-11-25T08:00:00.000Z'],
  ])('keeps the other reminder when the chat shows %s', async (_label, until) => {
    mocks.save.mockResolvedValueOnce('conflict');
    recheck.mockResolvedValue({ status: 'open', snoozedUntil: until });

    await expect(set()).resolves.toBe('unchanged');
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['keeps it while the follow-up label is on', 'open', true, 'unchanged', 1],
    ['removes it once the label is gone', 'open', false, 'cleared', 2],
    ['removes it when the chat is Done', 'resolved', true, 'cleared', 2],
  ])('after another write, a clear %s', async (_label, status, followUp, result, writes) => {
    mocks.clear.mockResolvedValueOnce('conflict');
    recheck.mockResolvedValue({ status, followUp });

    await expect(
      syncChatFollowUpReminder(client, {
        ...base,
        update: { followUpAt: null },
      })
    ).resolves.toBe(result);
    expect(mocks.clear).toHaveBeenCalledTimes(writes);
  });
});
