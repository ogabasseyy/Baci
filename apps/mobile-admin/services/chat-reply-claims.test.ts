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
  date = 1_700_000_000
): NotificationResponse {
  return {
    actionIdentifier: CHAT_REPLY_ACTION_ID,
    userText: text,
    notification: { date, request: { identifier: id } },
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

  it('still protects the session when storage is unavailable', async () => {
    store.failing = true;
    const claim = await freshClaim();

    expect(await claim(reply('e'))).toBe('new');
    expect(await claim(reply('e'))).toBe('repeat');
  });

  it('keeps only the most recent claims in storage', async () => {
    const claim = await freshClaim();

    for (let i = 0; i < 60; i += 1) await claim(reply(`n${i}`));

    const stored = JSON.parse(
      store.data.get('@baci_chat_reply_handled') ?? '[]'
    ) as string[];
    expect(stored).toHaveLength(50);
    expect(stored.at(-1)).toContain('n59');
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

  it('bugfix: a released claim lets the same words be sent again', async () => {
    const claim = await freshClaim();
    const { releaseChatReply } = await import('./chat-reply-claims');
    expect(await claim(reply('r1', 'Retry me'))).toBe('new');

    await releaseChatReply(reply('r1', 'Retry me'));

    expect(await claim(reply('r1', 'Retry me'))).toBe('new');
  });

  it('keeps a released claim released after a restart', async () => {
    const first = await freshClaim();
    await first(reply('r2', 'Again'));
    const { releaseChatReply } = await import('./chat-reply-claims');
    await releaseChatReply(reply('r2', 'Again'));

    vi.resetModules();
    const afterRestart = await freshClaim();

    expect(await afterRestart(reply('r2', 'Again'))).toBe('new');
  });
});
