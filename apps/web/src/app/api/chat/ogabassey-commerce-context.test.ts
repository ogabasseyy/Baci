import { describe, expect, it } from 'vitest';
import { resolveOgabasseyCommerceContext } from './ogabassey-commerce-context';

const hasRecentCommerceContext = (
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
) => resolveOgabasseyCommerceContext(messages).guarded;

describe('recent commerce context', () => {
  it('recognizes recent user or assistant commerce discussion', () => {
    expect(
      hasRecentCommerceContext([
        { role: 'assistant', content: 'Shall I add it to your cart?' },
        { role: 'user', content: 'Yes' },
      ])
    ).toBe(true);
  });

  it('ignores system messages and commerce outside the recent window', () => {
    expect(
      hasRecentCommerceContext([
        { role: 'system', content: 'Discuss the customer order.' },
        { role: 'user', content: 'My order' },
        ...Array.from({ length: 6 }, () => ({
          role: 'user' as const,
          content: 'Hello',
        })),
      ])
    ).toBe(false);
  });

  it('lets a self-contained joke request leave earlier commerce context', () => {
    expect(
      hasRecentCommerceContext([
        { role: 'user', content: 'How do I pay?' },
        {
          role: 'assistant',
          content:
            'For a new purchase, use your cart and checkout. For an existing order or delivery help, open your account orders or contact the store. Please do not share personal or payment details in chat.',
        },
        { role: 'user', content: 'Tell me a joke' },
      ])
    ).toBe(false);
  });

  it('keeps a joke about an order and a personal reply on the guarded path', () => {
    expect(
      hasRecentCommerceContext([
        { role: 'user', content: 'How do I pay?' },
        { role: 'user', content: 'Tell me a joke about my order' },
      ])
    ).toBe(true);
    expect(
      hasRecentCommerceContext([
        { role: 'assistant', content: 'Please provide your delivery name.' },
        { role: 'user', content: 'Jane Doe' },
      ])
    ).toBe(true);
    expect(
      hasRecentCommerceContext([
        {
          role: 'assistant',
          content: 'Please provide your delivery name and phone.',
        },
        { role: 'user', content: 'Jane Doe lives near Lagos' },
      ])
    ).toBe(true);
    expect(
      hasRecentCommerceContext([
        { role: 'user', content: 'How do I pay?' },
        { role: 'user', content: 'Tell me a joke, my number is 07012345678' },
      ])
    ).toBe(true);
  });

  it('does not treat repeated generic guidance as a customer commerce request', () => {
    const fallback =
      'For a new purchase, use your cart and checkout. For an existing order or delivery help, open your account orders or contact the store. Please do not share personal or payment details in chat.';
    expect(
      hasRecentCommerceContext([
        { role: 'assistant', content: fallback },
        { role: 'user', content: 'Could you explain more?' },
        { role: 'assistant', content: fallback },
        { role: 'user', content: 'What else can you do?' },
        { role: 'assistant', content: fallback },
        { role: 'user', content: 'What is artificial intelligence?' },
      ])
    ).toBe(false);
  });

  it('keeps an ambiguous name or number private after earlier commerce', () => {
    const earlier = [
      { role: 'user' as const, content: 'How do I pay?' },
      ...Array.from({ length: 6 }, () => ({
        role: 'assistant' as const,
        content: 'Please use your account for help.',
      })),
    ];
    for (const content of ['Jane Doe', '07012345678', 'Yes']) {
      expect(
        hasRecentCommerceContext([...earlier, { role: 'user', content }])
      ).toBe(true);
    }
  });

  it.each([
    'Jane Doe lives near Lagos',
    'My phone is 080 123 456 789',
  ])('guards a longer personal reply after earlier commerce: %s', (content) => {
    const fallback =
      'For a new purchase, use your cart and checkout. For an existing order or delivery help, open your account orders or contact the store. Please do not share personal or payment details in chat.';
    expect(
      hasRecentCommerceContext([
        { role: 'user', content: 'How do I pay?' },
        {
          role: 'assistant',
          content: 'Please provide your delivery name and phone.',
        },
        { role: 'user', content: 'Okay' },
        { role: 'assistant', content: fallback },
        { role: 'user', content: 'Could you explain more?' },
        { role: 'assistant', content: fallback },
        { role: 'user', content: 'What else can you do?' },
        { role: 'assistant', content: fallback },
        { role: 'user', content },
      ])
    ).toBe(true);
  });

  it('keeps a referential order follow-up guarded after a courtesy reply', () => {
    expect(
      hasRecentCommerceContext([
        { role: 'user', content: 'Check my order' },
        { role: 'assistant', content: 'Please use your account.' },
        { role: 'user', content: 'Thanks' },
        { role: 'assistant', content: 'You are welcome.' },
        { role: 'user', content: 'Can you check it for me?' },
      ])
    ).toBe(true);
  });

  it.each([
    'Tell me a story',
    'What is artificial intelligence?',
    'What can I do to relax?',
    'What is the weather in Lagos?',
  ])('allows a self-contained unrelated question after commerce: %s', (content) => {
    expect(
      hasRecentCommerceContext([
        { role: 'user', content: 'How do I pay?' },
        { role: 'assistant', content: 'Please use checkout.' },
        { role: 'user', content },
      ])
    ).toBe(false);
  });

  it('allows an affirmative reply to a new, independently anchored joke', () => {
    expect(
      hasRecentCommerceContext([
        { role: 'user', content: 'How do I pay?' },
        { role: 'assistant', content: 'Please use checkout.' },
        { role: 'user', content: 'Tell me a joke' },
        {
          role: 'assistant',
          content: 'Here is a joke. Would you like another joke?',
        },
        { role: 'user', content: 'Yes' },
      ])
    ).toBe(false);
  });

  it.each([
    'Jane Doe',
    'My phone is 080 123 456 789',
  ])('guards personal replies when only commerce guidance remains: %s', (content) => {
    expect(
      hasRecentCommerceContext([
        {
          role: 'assistant',
          content:
            'For a new purchase, use your cart and checkout. For an existing order or delivery help, open your account orders or contact the store. Please do not share personal or payment details in chat.',
        },
        { role: 'user', content },
      ])
    ).toBe(true);
  });

  it.each([
    'What is the status?',
    'What happened?',
    'What happens next?',
    'How long does processing take?',
    'Where can I send proof?',
    'What now?',
    'How long?',
    'What about the delay?',
    'When should I expect?',
    'What do we do?',
  ])('keeps an order-related question on the guarded path: %s', (content) => {
    expect(
      hasRecentCommerceContext([
        { role: 'user', content: 'Track my order' },
        { role: 'assistant', content: 'Please use your account.' },
        { role: 'user', content },
      ])
    ).toBe(true);
  });

  it.each([
    'What is your full name and phone number?',
    'Can I have your name?',
    'Could you send me your name and phone number?',
  ])('guards a reply to an assistant personal-details request: %s', (prompt) => {
    expect(
      hasRecentCommerceContext([
        { role: 'assistant', content: prompt },
        { role: 'user', content: 'Jane Doe' },
      ])
    ).toBe(true);
  });

  it('guards a likely phone number even on a first user turn', () => {
    expect(
      resolveOgabasseyCommerceContext([
        { role: 'user', content: 'My phone is 07012345678' },
      ]).guarded
    ).toBe(true);
  });

  it('isolates earlier unsolicited contact details from a new topic', () => {
    expect(
      resolveOgabasseyCommerceContext([
        { role: 'user', content: 'Amaka Okafor 07012345678' },
        { role: 'assistant', content: 'I see.' },
        { role: 'user', content: 'Tell me a joke' },
      ]).isolateHistory
    ).toBe(true);
  });

  it('guards a name following an assistant recipient question', () => {
    expect(
      hasRecentCommerceContext([
        { role: 'assistant', content: 'Who is the recipient?' },
        { role: 'user', content: 'Amaka Okafor' },
      ])
    ).toBe(true);
  });

  it('does not treat free-form personal context as a safe topic reset', () => {
    expect(
      hasRecentCommerceContext([
        { role: 'user', content: 'Track my order' },
        { role: 'assistant', content: 'Please use your account.' },
        {
          role: 'user',
          content: 'Tell me a story about ada who lives on broad street',
        },
      ])
    ).toBe(true);
  });

  it('handles maximum-length non-email history without pathological slowdown', () => {
    const messages = Array.from({ length: 50 }, () => ({
      role: 'user' as const,
      content: `${'a'.repeat(9_999)}@`,
    }));
    const started = performance.now();

    const result = resolveOgabasseyCommerceContext(messages);

    expect(result.guarded).toBe(false);
    expect(performance.now() - started).toBeLessThan(5_000);
  }, 30_000);
});
