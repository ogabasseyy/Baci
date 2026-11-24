import { CHAT_REPLY_ACTION_ID } from '@baci/shared';
import type { NotificationResponse } from 'expo-notifications';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  data: new Map<string, string>(),
  failing: false,
}));

vi.mock('@/lib/storage', () => ({
  asyncStorage: {
    getItem: async (key: string) => {
      if (store.failing) throw new Error('storage unavailable');
      return store.data.get(key) ?? null;
    },
    setItem: async (key: string, value: string) => {
      if (store.failing) throw new Error('storage unavailable');
      store.data.set(key, value);
    },
  },
}));

function reply(
  id: string,
  text = 'Hello',
  date = 1_700_000_000,
  data: Record<string, unknown> = {}
): NotificationResponse {
  return {
    actionIdentifier: CHAT_REPLY_ACTION_ID,
    userText: text,
    notification: {
      date,
      request: { identifier: id, content: { data } },
    },
  } as unknown as NotificationResponse;
}

beforeEach(() => {
  store.data.clear();
  store.failing = false;
  vi.resetModules();
});

async function freshClaim() {
  return (await import('./chat-reply-claims')).claimChatReply;
}

describe('claimChatReply', () => {
  it('claims a reply the first time and calls every repeat in this launch a repeat', async () => {
    const claim = await freshClaim();

    expect(await claim(reply('a'))).toBe('new');
    expect(await claim(reply('a'))).toBe('repeat');
  });

  it('lets only one of two deliveries in the same moment through', async () => {
    const claim = await freshClaim();

    const results = await Promise.all([claim(reply('b')), claim(reply('b'))]);

    expect(results.filter((result) => result === 'new')).toHaveLength(1);
  });

  it('treats a different reply as new', async () => {
    const claim = await freshClaim();

    expect(await claim(reply('c', 'one'))).toBe('new');
    expect(await claim(reply('c', 'two'))).toBe('new');
  });

  it('bugfix: refuses a reply that was already claimed before the app restarted', async () => {
    const first = await freshClaim();
    expect(await first(reply('d'))).toBe('new');

    // A restart: a fresh module (empty memory), same storage, and the last
    // notification response is read again at launch.
    vi.resetModules();
    const afterRestart = await freshClaim();

    // Not 'new' (never sent again) and not 'repeat' (the owner is taken to
    // the chat to check, since the first attempt may not have finished).
    expect(await afterRestart(reply('d'))).toBe('replay');
  });

  it('bugfix: rejects, so nothing is sent, when the claim cannot be stored', async () => {
    store.failing = true;
    const claim = await freshClaim();

    await expect(claim(reply('e'))).rejects.toThrow('storage unavailable');
  });

  it('still protects the session after a storage failure', async () => {
    store.failing = true;
    const claim = await freshClaim();
    const response = reply('e');

    await expect(claim(response)).rejects.toThrow();
    expect(await claim(response)).toBe('repeat');
  });

  it('keeps only the most recent claims in storage', async () => {
    const claim = await freshClaim();

    for (let i = 0; i < 510; i += 1) await claim(reply(`n${i}`));

    const stored = JSON.parse(
      store.data.get('@baci_chat_reply_handled') ?? '[]'
    ) as string[];
    expect(stored).toHaveLength(500);
    expect(stored.at(-1)).toContain('n509');
  });

  it('bugfix: never stores what the owner typed, only a fingerprint of it', async () => {
    const claim = await freshClaim();
    const secret = 'My private reply with a phone number 0801 234 5678';

    await claim(reply('s1', secret));

    const stored = store.data.get('@baci_chat_reply_handled') ?? '';
    expect(stored).not.toContain('private reply');
    expect(stored).not.toContain('0801');
  });

  it('keeps stored claims short however long the reply is', async () => {
    const claim = await freshClaim();

    await claim(reply('s2', 'x'.repeat(2_000)));

    const stored = JSON.parse(
      store.data.get('@baci_chat_reply_handled') ?? '[]'
    ) as string[];
    expect(stored[0].length).toBeLessThan(60);
  });

  it('bugfix: counts the same reply once even when the two deliveries carry different dates', async () => {
    const claim = await freshClaim();

    expect(await claim(reply('d1', 'Same words', 1_700_000_000))).toBe('new');
    expect(await claim(reply('d1', 'Same words', 1_700_000_999))).toBe(
      'repeat'
    );
  });

  it('shows a reply that sends nothing once per launch, without storing it', async () => {
    const { firstSightThisLaunch } = await import('./chat-reply-claims');
    const response = reply('v1', 'too long');

    expect(firstSightThisLaunch(response)).toBe(true);
    expect(firstSightThisLaunch(response)).toBe(false);
    expect(store.data.get('@baci_chat_reply_handled')).toBeUndefined();
  });

  it('bugfix: two different replies handled together are both remembered after a restart', async () => {
    const claim = await freshClaim();

    const results = await Promise.all([
      claim(reply('c1', 'First reply')),
      claim(reply('c2', 'Second reply')),
    ]);
    expect(results).toEqual(['new', 'new']);

    vi.resetModules();
    const afterRestart = await freshClaim();

    expect(await afterRestart(reply('c1', 'First reply'))).toBe('replay');
    expect(await afterRestart(reply('c2', 'Second reply'))).toBe('replay');
  });

  it('bugfix: the same words for two different chats are two replies, not a repeat', async () => {
    const claim = await freshClaim();
    const toChat = (conversationId: number) =>
      reply('same-id', 'Yes, in stock', 1_700_000_000, {
        merchant_id: '11111111-1111-4111-8111-111111111111',
        conversation_id: conversationId,
      });

    expect(await claim(toChat(21))).toBe('new');
    expect(await claim(toChat(22))).toBe('new');
  });

  it('bugfix: the in-memory claims are capped too, so a long launch does not grow without bound', async () => {
    const claim = await freshClaim();
    await claim(reply('first-ever', 'x'));

    for (let i = 0; i < 510; i += 1) await claim(reply(`m${i}`, 'x'));

    // Forgotten from memory (and from storage): no longer a 'repeat'.
    expect(await claim(reply('first-ever', 'x'))).not.toBe('repeat');
  });
});
