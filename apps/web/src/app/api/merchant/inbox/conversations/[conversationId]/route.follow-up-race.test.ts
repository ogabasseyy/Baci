// Two team members changing one chat's follow-up at nearly the same moment, run
// through the real route and reminder modules against an in-memory table.
import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeReminderTable } from '@/lib/chatwoot/chat-follow-up-reminder-table.test-support';

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  update: vi.fn(),
  read: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/chatwoot/merchant-inbox-request', () => ({
  resolveMerchantInboxRequest: mocks.resolve,
  merchantInboxError: (status: number, error: string, code: string) =>
    NextResponse.json({ error, code }, { status }),
  merchantInboxJson: (body: unknown) => NextResponse.json(body),
}));
vi.mock('@/lib/chatwoot/merchant-inbox-client', () => ({
  getMerchantInboxConversation: mocks.read,
}));
vi.mock('@/lib/chatwoot/merchant-inbox-manage-client', () => ({
  updateMerchantInboxConversation: mocks.update,
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: async () => ({ valid: true }),
}));

import { PATCH } from './route';

const merchantId = 'c4a70000-0000-4000-8000-0000000000b1';
const nine = '2026-11-25T09:00:00.000Z';
const ten = '2026-11-25T10:00:00.000Z';
const justAfterNine = '2026-11-25T09:00:30.000Z';
/** A customer message reopens a snoozed chat; the follow-up label stays. */
const reopened = { status: 'open', followUp: true, snoozedUntil: null };

type Change = { followUpAt: string | null };

let table: ReturnType<typeof fakeReminderTable>;
let engine: Record<string, unknown>;

const snoozed = (until: string) => ({
  status: 'snoozed',
  followUp: true,
  snoozedUntil: until,
});
const cleared = { status: 'open', followUp: false, snoozedUntil: null };
const shown = () => ({
  ok: true,
  conversation: { id: 7, customerName: 'Ada', ...engine },
});
const dueTimes = () => table.rows.map((row) => row.due_at);

const patch = (change: Change) =>
  PATCH(
    new NextRequest(
      'https://app.example.test/api/merchant/inbox/conversations/7',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(change),
      }
    ),
    { params: Promise.resolve({ conversationId: '7' }) }
  );

/** The engine takes the change and answers with what it shows right then. */
const apply = (change: Change) => {
  engine = change.followUpAt ? snoozed(change.followUpAt) : cleared;
  return shown();
};

/**
 * `older` is applied and read back by the engine, then `newer` runs from start
 * to finish (and `meanwhile` may change the chat) before `older` gets to write
 * its reminder.
 */
async function overtaken(
  older: Change,
  newer: Change,
  meanwhile?: typeof reopened
) {
  mocks.update.mockImplementationOnce(async () => {
    const answer = apply(older);
    mocks.update.mockImplementationOnce(async () => apply(newer));
    await patch(newer);
    if (meanwhile) engine = meanwhile;
    return answer;
  });
  await patch(older);
}

beforeEach(async () => {
  vi.resetAllMocks();
  table = fakeReminderTable();
  engine = cleared;
  mocks.read.mockImplementation(async () => shown());
  mocks.resolve.mockResolvedValue({
    ok: true,
    binding: { merchantId },
    supabase: table.client,
  });
});

describe('bugfix: two team members changing one follow-up at the same moment', () => {
  const existing = async (until: string) => {
    mocks.update.mockImplementationOnce(async () =>
      apply({ followUpAt: until })
    );
    await patch({ followUpAt: until });
  };

  it('an older clear does not delete the newer reminder', async () => {
    await existing(nine);
    await overtaken({ followUpAt: null }, { followUpAt: ten });
    expect(dueTimes()).toEqual([ten]);
  });

  it('an older clear does not delete a newer save of the same time', async () => {
    await existing(nine);
    await overtaken({ followUpAt: null }, { followUpAt: nine });
    expect(dueTimes()).toEqual([nine]);
  });

  it('an older save does not replace the newer reminder', async () => {
    await existing('2026-11-25T08:00:00.000Z');
    await overtaken({ followUpAt: nine }, { followUpAt: ten });
    expect(dueTimes()).toEqual([ten]);
  });

  it('an older save does not replace a newer first reminder', async () => {
    await overtaken({ followUpAt: nine }, { followUpAt: ten });
    expect(dueTimes()).toEqual([ten]);
  });

  it('an older save does not replace a newer one set seconds later', async () => {
    await existing('2026-11-25T08:00:00.000Z');
    await overtaken({ followUpAt: nine }, { followUpAt: justAfterNine });
    expect(dueTimes()).toEqual([justAfterNine]);
  });

  it.each([
    ['save', { followUpAt: nine }],
    ['clear', { followUpAt: null }],
  ])('an older %s leaves the newer reminder when the chat has reopened', async (_label, older) => {
    await existing('2026-11-25T08:00:00.000Z');
    await overtaken(older, { followUpAt: ten }, reopened);
    expect(dueTimes()).toEqual([ten]);
  });

  it.each([
    ['a chat with a reminder', true],
    ['a chat without one', false],
  ])('the newer save still lands when the older one writes first, on %s', async (_label, hasReminder) => {
    await olderWritesFirst(hasReminder, ten);
  });

  it('the newer save still lands when it is only seconds after the older', async () => {
    await olderWritesFirst(true, justAfterNine);
  });

  async function olderWritesFirst(hasReminder: boolean, later: string) {
    if (hasReminder) await existing('2026-11-25T08:00:00.000Z');
    const answers: Array<() => void> = [];
    const heldBack = (change: Change) => () => {
      const answer = apply(change);
      return new Promise((resolve) => answers.push(() => resolve(answer)));
    };
    mocks.update
      .mockImplementationOnce(heldBack({ followUpAt: nine }))
      .mockImplementationOnce(heldBack({ followUpAt: later }));

    const older = patch({ followUpAt: nine });
    await vi.waitFor(() => expect(answers).toHaveLength(1));
    const newer = patch({ followUpAt: later });
    await vi.waitFor(() => expect(answers).toHaveLength(2));
    answers[0]();
    await older;
    answers[1]();
    await newer;

    expect(dueTimes()).toEqual([later]);
  }
});
