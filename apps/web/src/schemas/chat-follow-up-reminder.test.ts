import { describe, expect, it } from 'vitest';
import {
  chatFollowUpRecordResultSchema,
  dueChatFollowUpReminderListSchema,
  dueChatFollowUpReminderSchema,
} from './chat-follow-up-reminder';

const row = {
  reminder_id: '5f2d3c1e-8a47-4b69-9c0e-1a2b3c4d5e6f',
  merchant_id: 'c4a70000-0000-4000-8000-0000000000b1',
  conversation_id: 7,
  due_at: '2026-11-25T09:00:00+00:00',
  customer_name: '',
};

describe('dueChatFollowUpReminderSchema', () => {
  it('accepts a listed reminder, with or without a name', () => {
    expect(dueChatFollowUpReminderSchema.safeParse(row).success).toBe(true);
    expect(
      dueChatFollowUpReminderSchema.safeParse({ ...row, customer_name: 'Ada' })
        .success
    ).toBe(true);
  });

  it.each([
    ['a bad reminder id', { reminder_id: 'x' }],
    ['a zero chat id', { conversation_id: 0 }],
    ['a fractional chat id', { conversation_id: 1.5 }],
    ['an oversized name', { customer_name: 'x'.repeat(81) }],
  ])('rejects %s', (_label, patch) => {
    expect(
      dueChatFollowUpReminderSchema.safeParse({ ...row, ...patch }).success
    ).toBe(false);
  });

  it('caps a list at the database limit', () => {
    expect(
      dueChatFollowUpReminderListSchema.safeParse(Array(51).fill(row)).success
    ).toBe(false);
  });
});

describe('chatFollowUpRecordResultSchema', () => {
  it.each(['notified', 'muted', 'ignored'])('accepts %s', (outcome) => {
    expect(chatFollowUpRecordResultSchema.safeParse({ outcome }).success).toBe(
      true
    );
  });

  it('rejects an outcome of another kind of alert', () => {
    expect(
      chatFollowUpRecordResultSchema.safeParse({ outcome: 'coalesced' }).success
    ).toBe(false);
  });
});
