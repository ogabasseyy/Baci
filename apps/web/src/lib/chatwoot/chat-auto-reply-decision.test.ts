import { describe, expect, it } from 'vitest';
import {
  asksForHuman,
  decideChatAutoReply,
  isMerchantReply,
} from './chat-auto-reply-decision';

const event = (status: string | null, content: string | null = 'Hi') => ({
  content,
  conversation: { id: 5, status },
});

describe('decideChatAutoReply', () => {
  it('answers a customer message in a pending conversation', () => {
    expect(decideChatAutoReply(event('pending'))).toEqual({ action: 'reply' });
  });

  it.each([
    'open',
    'resolved',
    'snoozed',
    null,
  ])('stays silent when a person owns the conversation (%s)', (status) => {
    expect(decideChatAutoReply(event(status))).toEqual({
      action: 'skip',
      reason: 'not_pending',
    });
  });

  it('skips an empty message', () => {
    expect(decideChatAutoReply(event('pending', '   '))).toEqual({
      action: 'skip',
      reason: 'empty',
    });
    expect(decideChatAutoReply(event('pending', null)).action).toBe('skip');
  });

  it('hands over when the customer asks for a person', () => {
    expect(
      decideChatAutoReply(event('pending', 'I want to speak to a human'))
    ).toEqual({ action: 'handover', reason: 'customer_requested_human' });
  });
});

describe('asksForHuman', () => {
  it.each([
    'Can I talk to a real person?',
    'connect me to someone please',
    'live agent',
    'human please',
    'I need customer service',
    "you're a bot, I'm not talking to a bot",
  ])('detects "%s"', (text) => {
    expect(asksForHuman(text)).toBe(true);
  });

  it.each([
    'Do you have the iPhone 15 in blue?',
    'What is your human hair wig price?',
    'Is the agent phone case available?',
  ])('leaves "%s" to the assistant', (text) => {
    expect(asksForHuman(text)).toBe(false);
  });
});

describe('isMerchantReply', () => {
  const base = { message_type: 'outgoing', private: false } as const;

  it('is a visible reply from staff', () => {
    expect(isMerchantReply({ ...base, sender: { type: 'user' } })).toBe(true);
  });

  it.each([
    ['the assistant bot', { ...base, sender: { type: 'agent_bot' } }],
    ['a private note', { ...base, private: true, sender: { type: 'user' } }],
    [
      'a customer message',
      { message_type: 'incoming', sender: { type: 'user' } },
    ],
    ['an unknown sender', { ...base, sender: null }],
    [
      'an automation rule message',
      {
        ...base,
        sender: { type: 'user' },
        content_attributes: { automation_rule_id: 4 },
      },
    ],
    [
      'a campaign message',
      {
        ...base,
        sender: { type: 'user' },
        additional_attributes: { campaign_id: 9 },
      },
    ],
  ])('is not %s', (_label, input) => {
    expect(isMerchantReply(input)).toBe(false);
  });
});

describe('decideChatAutoReply attachments', () => {
  const pending = { id: 1, status: 'pending', labels: [] };

  it('hands an attachment-only message to a person', () => {
    expect(
      decideChatAutoReply({
        content: '',
        attachments: [{ file_type: 'image' }],
        conversation: pending,
      })
    ).toEqual({ action: 'handover', reason: 'customer_sent_attachment' });
  });

  it('still skips an empty message with no attachment', () => {
    expect(
      decideChatAutoReply({ content: '  ', conversation: pending })
    ).toEqual({ action: 'skip', reason: 'empty' });
  });

  it('hands over a captioned attachment: the assistant cannot see the picture', () => {
    expect(
      decideChatAutoReply({
        content: 'how much is this?',
        attachments: [{ file_type: 'image' }],
        conversation: pending,
      })
    ).toEqual({ action: 'handover', reason: 'customer_sent_attachment' });
  });
});
