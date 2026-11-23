import { describe, expect, it } from 'vitest';
import {
  compareMerchantInboxMessages,
  projectMerchantInboxConversation,
  projectMerchantInboxMessage,
} from './merchant-inbox-projection';

const CREATED = 1_794_720_151;
const CREATED_ISO = new Date(CREATED * 1000).toISOString();

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: 128,
    content: 'Do you have the Demo Phone X?',
    message_type: 0,
    private: false,
    created_at: CREATED,
    content_type: 'text',
    sender: { name: 'Synthetic Visitor' },
    ...overrides,
  };
}

describe('projectMerchantInboxMessage', () => {
  it('projects a customer message without provider internals', () => {
    expect(
      projectMerchantInboxMessage(
        message({ account_id: 2, sender: { email: 'hidden@example.invalid' } })
      )
    ).toEqual({
      id: 128,
      sender: 'customer',
      kind: 'text',
      text: 'Do you have the Demo Phone X?',
      createdAt: CREATED_ISO,
    });
  });

  it.each([
    [{ message_type: 1, sender: { type: 'user' } }, 'store'],
    [{ message_type: 1, sender: null }, 'store'],
    [{ message_type: 1, sender: { type: 'agent_bot' } }, 'assistant'],
    [{ message_type: 3 }, 'system'],
  ])('labels the sender for %o', (overrides, sender) => {
    expect(projectMerchantInboxMessage(message(overrides))?.sender).toBe(
      sender
    );
  });

  it('includes product titles for a product card', () => {
    expect(
      projectMerchantInboxMessage(
        message({
          message_type: 1,
          content: 'Here it is:',
          content_type: 'cards',
          content_attributes: {
            items: [{ title: 'Synthetic Demo Phone X' }, { title: 7 }],
          },
        })
      )
    ).toMatchObject({
      kind: 'product_card',
      text: 'Here it is:\nSynthetic Demo Phone X',
    });
  });

  it.each([
    ['a private note', { private: true }],
    ['an activity row', { message_type: 2 }],
    ['an empty text message', { content: '  ' }],
    ['a malformed id', { id: 'abc' }],
  ])('drops %s', (_label, overrides) => {
    expect(projectMerchantInboxMessage(message(overrides))).toBeNull();
  });

  it('keeps an attachment-only message as an empty other message', () => {
    expect(
      projectMerchantInboxMessage(
        message({
          content: null,
          content_type: 'text',
          attachments: [
            { file_type: 'image', data_url: 'https://x.invalid/a' },
          ],
        })
      )
    ).toEqual({
      id: 128,
      sender: 'customer',
      kind: 'other',
      text: '',
      createdAt: CREATED_ISO,
    });
  });

  it('still drops an empty text message without attachments', () => {
    expect(
      projectMerchantInboxMessage(message({ content: null, attachments: [] }))
    ).toBeNull();
  });

  it('caps very long text', () => {
    expect(
      projectMerchantInboxMessage(message({ content: 'a'.repeat(9_000) }))?.text
    ).toHaveLength(4_000);
  });
});

describe('message ordering and truncation', () => {
  it('does not split a surrogate pair at the cap', () => {
    const text = projectMerchantInboxMessage(
      message({ content: `${'a'.repeat(3_999)}😀tail` })
    )?.text;
    expect(text).toBe('a'.repeat(3_999));
  });

  // Each case puts the 4,000-unit cap in the middle of one visible character.
  it.each([
    ['a flag', 3_997, '🇳🇬'],
    ['a family emoji', 3_997, '👨‍👩‍👧'],
    ['a letter with its accent', 3_999, 'e\u0301'],
  ])('bugfix: does not leave half of %s at the cap', (_name, before, glyph) => {
    const text = projectMerchantInboxMessage(
      message({ content: `${'a'.repeat(before)}${glyph}tail` })
    )?.text;
    expect(text).toBe('a'.repeat(before));
  });

  it('orders by creation time and uses the id only to break ties', () => {
    const at = (id: number, seconds: number) =>
      projectMerchantInboxMessage(message({ id, created_at: seconds }));
    const sorted = [at(5, CREATED + 10), at(9, CREATED), at(7, CREATED)]
      .filter((value) => value !== null)
      .sort(compareMerchantInboxMessages)
      .map((value) => value.id);
    expect(sorted).toEqual([7, 9, 5]);
  });
});

describe('projectMerchantInboxConversation', () => {
  const conversation = {
    id: 21,
    inbox_id: 2,
    status: 'open',
    unread_count: 1,
    last_activity_at: CREATED,
    meta: {
      sender: { name: '  damp-breeze-998  ', email: 'x@example.invalid' },
    },
    last_non_activity_message: message(),
  };

  it('projects a conversation in the bound inbox', () => {
    expect(projectMerchantInboxConversation(conversation, 2)).toEqual({
      id: 21,
      status: 'open',
      unreadCount: 1,
      customerName: 'damp-breeze-998',
      lastActivityAt: CREATED_ISO,
      lastMessage: {
        id: 128,
        sender: 'customer',
        kind: 'text',
        text: 'Do you have the Demo Phone X?',
        createdAt: CREATED_ISO,
      },
      tags: [],
      priority: null,
      followUp: false,
      snoozedUntil: null,
    });
  });

  it('projects tags, priority and follow-up without leaking system labels', () => {
    const result = projectMerchantInboxConversation(
      {
        ...conversation,
        status: 'snoozed',
        labels: ['handled-by-ai', 'tag-payment', 'follow-up'],
        priority: 'high',
        snoozed_until: CREATED + 3600,
      },
      2
    );
    expect(result).toMatchObject({
      tags: ['payment'],
      priority: 'high',
      followUp: true,
      snoozedUntil: new Date((CREATED + 3600) * 1000).toISOString(),
    });
  });

  it('reads an ISO snooze time and ignores an unknown priority', () => {
    const result = projectMerchantInboxConversation(
      {
        ...conversation,
        status: 'snoozed',
        priority: 'someday',
        snoozed_until: '2026-11-23T08:00:00.000Z',
      },
      2
    );
    expect(result).toMatchObject({
      priority: null,
      snoozedUntil: '2026-11-23T08:00:00.000Z',
    });
  });

  it('previews an attachment-only last message', () => {
    const result = projectMerchantInboxConversation(
      {
        ...conversation,
        last_non_activity_message: message({
          content: null,
          attachments: [{ file_type: 'image' }],
        }),
      },
      2
    );
    expect(result?.lastMessage).toMatchObject({ kind: 'other', text: '' });
  });

  it('rejects a conversation from another inbox', () => {
    expect(projectMerchantInboxConversation(conversation, 3)).toBeNull();
  });

  it('falls back to a neutral name and no preview', () => {
    expect(
      projectMerchantInboxConversation(
        { id: 22, inbox_id: 2, status: 'pending' },
        2
      )
    ).toEqual({
      id: 22,
      status: 'pending',
      unreadCount: 0,
      customerName: 'Customer',
      lastActivityAt: null,
      lastMessage: null,
      tags: [],
      priority: null,
      followUp: false,
      snoozedUntil: null,
    });
  });

  it('does not split an emoji at the end of a long name', () => {
    const projected = projectMerchantInboxConversation(
      { ...conversation, meta: { sender: { name: `${'n'.repeat(79)}😀x` } } },
      2
    );
    expect(projected?.customerName).toBe('n'.repeat(79));
  });

  it('rejects an unknown status', () => {
    expect(
      projectMerchantInboxConversation({ ...conversation, status: 'weird' }, 2)
    ).toBeNull();
  });
});
