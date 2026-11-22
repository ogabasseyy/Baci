import { describe, expect, it } from 'vitest';
import {
  chatEventIntakeResultSchema,
  chatWebhookEnvelopeSchema,
  chatWebhookMessageCreatedSchema,
} from './chat-webhook';

const validMessage = {
  event: 'message_created',
  id: 42,
  message_type: 'incoming',
  private: false,
  content: 'hello',
  account: { id: 1 },
  inbox: { id: 2 },
  conversation: { id: 3 },
  sender: { name: 'Ada' },
};

describe('chatWebhookEnvelopeSchema', () => {
  it('accepts an event name and ignores extra fields', () => {
    const parsed = chatWebhookEnvelopeSchema.parse({
      event: 'message_created',
      extra: true,
    });
    expect(parsed).toEqual({ event: 'message_created' });
  });

  it('rejects an empty, missing or over-long event name', () => {
    expect(chatWebhookEnvelopeSchema.safeParse({ event: '' }).success).toBe(
      false
    );
    expect(chatWebhookEnvelopeSchema.safeParse({}).success).toBe(false);
    expect(
      chatWebhookEnvelopeSchema.safeParse({ event: 'x'.repeat(81) }).success
    ).toBe(false);
    expect(
      chatWebhookEnvelopeSchema.safeParse({ event: 'x'.repeat(80) }).success
    ).toBe(true);
  });
});

describe('chatWebhookMessageCreatedSchema', () => {
  it('accepts a complete message and optional empty fields', () => {
    expect(
      chatWebhookMessageCreatedSchema.safeParse(validMessage).success
    ).toBe(true);
    expect(
      chatWebhookMessageCreatedSchema.safeParse({
        ...validMessage,
        private: null,
        content: null,
        sender: null,
      }).success
    ).toBe(true);
    const {
      sender: _sender,
      private: _private,
      content: _content,
      ...bare
    } = validMessage;
    expect(chatWebhookMessageCreatedSchema.safeParse(bare).success).toBe(true);
  });

  it('rejects other event names', () => {
    expect(
      chatWebhookMessageCreatedSchema.safeParse({
        ...validMessage,
        event: 'conversation_created',
      }).success
    ).toBe(false);
  });

  it.each([
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    '7',
    null,
  ])('rejects an invalid provider id %s', (bad) => {
    expect(
      chatWebhookMessageCreatedSchema.safeParse({ ...validMessage, id: bad })
        .success
    ).toBe(false);
    expect(
      chatWebhookMessageCreatedSchema.safeParse({
        ...validMessage,
        account: { id: bad },
      }).success
    ).toBe(false);
    expect(
      chatWebhookMessageCreatedSchema.safeParse({
        ...validMessage,
        inbox: { id: bad },
      }).success
    ).toBe(false);
    expect(
      chatWebhookMessageCreatedSchema.safeParse({
        ...validMessage,
        conversation: { id: bad },
      }).success
    ).toBe(false);
  });

  it('accepts the largest safe integer id', () => {
    expect(
      chatWebhookMessageCreatedSchema.safeParse({
        ...validMessage,
        id: Number.MAX_SAFE_INTEGER,
      }).success
    ).toBe(true);
  });

  it('limits the message type length to 40 characters', () => {
    expect(
      chatWebhookMessageCreatedSchema.safeParse({
        ...validMessage,
        message_type: 'x'.repeat(40),
      }).success
    ).toBe(true);
    expect(
      chatWebhookMessageCreatedSchema.safeParse({
        ...validMessage,
        message_type: 'x'.repeat(41),
      }).success
    ).toBe(false);
  });

  it('requires the nested account, inbox and conversation objects', () => {
    for (const key of ['account', 'inbox', 'conversation'] as const) {
      const { [key]: _removed, ...rest } = validMessage;
      expect(chatWebhookMessageCreatedSchema.safeParse(rest).success).toBe(
        false
      );
    }
  });
});

describe('chatEventIntakeResultSchema', () => {
  it.each([
    'notified',
    'coalesced',
    'muted',
    'ignored',
  ] as const)('accepts the %s outcome', (outcome) => {
    expect(chatEventIntakeResultSchema.parse({ outcome })).toEqual({
      outcome,
    });
  });

  it('accepts the duplicate flag and rejects unknown outcomes', () => {
    expect(
      chatEventIntakeResultSchema.parse({
        outcome: 'notified',
        duplicate: true,
      })
    ).toEqual({ outcome: 'notified', duplicate: true });
    expect(
      chatEventIntakeResultSchema.safeParse({ outcome: 'other' }).success
    ).toBe(false);
    expect(chatEventIntakeResultSchema.safeParse({}).success).toBe(false);
    expect(
      chatEventIntakeResultSchema.safeParse({
        outcome: 'muted',
        duplicate: 'yes',
      }).success
    ).toBe(false);
  });
});

describe('message_created assistant fields', () => {
  const base = {
    event: 'message_created',
    id: 1,
    message_type: 'outgoing',
    account: { id: 2 },
    inbox: { id: 3 },
  };

  it('reads the sender type, conversation status and labels', () => {
    const parsed = chatWebhookMessageCreatedSchema.parse({
      ...base,
      conversation: { id: 4, status: 'pending', labels: ['vip'] },
      sender: { name: 'Staff', type: 'user' },
    });
    expect(parsed.conversation).toMatchObject({
      status: 'pending',
      labels: ['vip'],
    });
    expect(parsed.sender?.type).toBe('user');
  });

  it('still accepts a payload without them', () => {
    expect(
      chatWebhookMessageCreatedSchema.safeParse({
        ...base,
        conversation: { id: 4 },
      }).success
    ).toBe(true);
  });

  it('drops an over-long label instead of rejecting the message', () => {
    const parsed = chatWebhookMessageCreatedSchema.parse({
      ...base,
      conversation: { id: 4, labels: ['vip', 'x'.repeat(101)] },
    });
    expect(parsed.conversation.labels).toEqual(['vip']);
  });

  it('rejects labels that are not a short list of strings', () => {
    expect(
      chatWebhookMessageCreatedSchema.safeParse({
        ...base,
        conversation: { id: 4, labels: [1] },
      }).success
    ).toBe(false);
  });
});
