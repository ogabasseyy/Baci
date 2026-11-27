import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('./chat-event-push', () => ({ sendChatEventPush: vi.fn() }));
vi.mock('./chat-follow-up-reminder-check', () => ({
  checkFollowUpStillDue: vi.fn(),
}));

import { sweepChatFollowUpReminders } from './chat-follow-up-reminder-sweep';

const reminders = [1, 2, 3].map((n) => ({
  reminder_id: `5f2d3c1e-8a47-4b69-9c0e-1a2b3c4d5e0${n}`,
  merchant_id: 'c4a70000-0000-4000-8000-0000000000b1',
  conversation_id: 10 + n,
  due_at: `2026-11-25T0${n}:00:00+00:00`,
  customer_name: 'Ada',
}));

/** Each engine read spends the whole budget, so one reminder fits per run. */
async function slowRun(random: number): Promise<number[]> {
  let clock = 0;
  const looked: number[] = [];
  await sweepChatFollowUpReminders({
    now: () => clock,
    random: () => random,
    list: async () => ({ ok: true, reminders }),
    check: async ({ conversationId }) => {
      looked.push(conversationId);
      clock += 31_000;
      return 'unknown';
    },
    record: vi.fn(),
    push: vi.fn(),
    release: vi.fn(),
  });
  return looked;
}

describe('bugfix: slow reminders at the front starved the rest of the batch', () => {
  it.each([
    [0, 11],
    [0.4, 12],
    [0.7, 13],
    [0.999, 13],
  ])('starts at a different place in the batch (random %s)', async (random, first) => {
    await expect(slowRun(random)).resolves.toEqual([first]);
  });

  it('wraps round so every reminder still gets its turn in a quick run', async () => {
    const looked: number[] = [];
    await sweepChatFollowUpReminders({
      now: () => 0,
      random: () => 0.7,
      list: async () => ({ ok: true, reminders }),
      check: async ({ conversationId }) => {
        looked.push(conversationId);
        return 'unknown';
      },
      record: vi.fn(),
      push: vi.fn(),
      release: vi.fn(),
    });
    expect(looked).toEqual([13, 11, 12]);
  });
});
