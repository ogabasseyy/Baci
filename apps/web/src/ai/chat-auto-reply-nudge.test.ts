import { describe, expect, it } from 'vitest';
import type { ChatAutoReply } from '@/schemas/chat-auto-reply';
import {
  CHAT_CART_LIMIT_REPLY,
  CHAT_NARROW_DOWN_NUDGE,
  withCartLimit,
  withNarrowDownNudge,
} from './chat-auto-reply-nudge';

const draft = (overrides: Partial<ChatAutoReply> = {}): ChatAutoReply => ({
  reply: 'We have the Demo Phone X at NGN 450000.',
  confidence: 0.9,
  needsHuman: false,
  ...overrides,
});

describe('withNarrowDownNudge', () => {
  it('uses the exact wording the old storefront chat showed', () => {
    expect(CHAT_NARROW_DOWN_NUDGE).toBe(
      'Want to narrow these down? Tell me your budget, preferred brand, or what matters most.'
    );
  });

  it.each([
    'discover',
    'recommend',
  ] as const)('adds the nudge after a %s answer that listed products', (intent) => {
    const result = withNarrowDownNudge(draft({ intent }), 3);
    expect(result.reply).toBe(
      `We have the Demo Phone X at NGN 450000.\n\n${CHAT_NARROW_DOWN_NUDGE}`
    );
  });

  it('does not add it to an add-to-cart answer', () => {
    const original = draft({
      intent: 'add_to_cart',
      reply: 'Added the Demo Phone X to your cart.',
    });
    expect(withNarrowDownNudge(original, 3)).toEqual(original);
  });

  it.each([
    ['details', 'details'],
    ['other', 'other'],
    ['a missing intent', undefined],
  ] as const)('does not add it for %s', (_label, intent) => {
    const original = draft({ intent });
    expect(withNarrowDownNudge(original, 3)).toEqual(original);
  });

  it('does not add it when no product was found to narrow down', () => {
    const original = draft({ intent: 'discover' });
    expect(withNarrowDownNudge(original, 0)).toEqual(original);
  });

  it('does not add it to a hand-over', () => {
    const original = draft({
      intent: 'discover',
      needsHuman: true,
      reply: '',
    });
    expect(withNarrowDownNudge(original, 3)).toEqual(original);
  });

  it('leaves a reply alone when the line would push it past the length limit', () => {
    const long = {
      reply: 'a'.repeat(950),
      confidence: 0.9,
      needsHuman: false,
      intent: 'discover' as const,
    };
    expect(withNarrowDownNudge(long, 3)).toEqual(long);
  });

  it('does not repeat it when the reply already says it', () => {
    const original = draft({
      intent: 'recommend',
      reply: `Here are two options. ${CHAT_NARROW_DOWN_NUDGE}`,
    });
    expect(withNarrowDownNudge(original, 2)).toEqual(original);
  });
});

describe('withCartLimit', () => {
  it('replaces whatever the model said for an add-to-cart request', () => {
    const result = withCartLimit(
      draft({ intent: 'add_to_cart', reply: 'Done, added to your cart!' })
    );
    expect(result.reply).toBe(CHAT_CART_LIMIT_REPLY);
    expect(result.reply).toMatch(/can't/i);
  });

  it.each([
    'discover',
    'recommend',
    'details',
    'other',
    undefined,
  ] as const)('leaves a %s answer alone', (intent) => {
    const original = draft({ intent });
    expect(withCartLimit(original)).toEqual(original);
  });

  it('leaves a hand-over alone', () => {
    const original = draft({
      intent: 'add_to_cart',
      needsHuman: true,
      reply: '',
    });
    expect(withCartLimit(original)).toEqual(original);
  });
});
