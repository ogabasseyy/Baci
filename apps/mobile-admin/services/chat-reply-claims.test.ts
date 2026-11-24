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

function reply(id: string, text = 'Hello'): NotificationResponse {
  return {
    actionIdentifier: 'chat_reply_send',
    userText: text,
    notification: { date: 1_700_000_000, request: { identifier: id } },
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
  it('claims a reply the first time and refuses every repeat', async () => {
    const claim = await freshClaim();

    expect(await claim(reply('a'))).toBe(true);
    expect(await claim(reply('a'))).toBe(false);
  });

  it('lets only one of two deliveries in the same moment through', async () => {
    const claim = await freshClaim();

    const results = await Promise.all([claim(reply('b')), claim(reply('b'))]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('treats a different reply as new', async () => {
    const claim = await freshClaim();

    expect(await claim(reply('c', 'one'))).toBe(true);
    expect(await claim(reply('c', 'two'))).toBe(true);
  });

  it('bugfix: refuses a reply that was already claimed before the app restarted', async () => {
    const first = await freshClaim();
    expect(await first(reply('d'))).toBe(true);

    // A restart: a fresh module (empty memory), same storage, and the last
    // notification response is read again at launch.
    vi.resetModules();
    const afterRestart = await freshClaim();

    expect(await afterRestart(reply('d'))).toBe(false);
  });

  it('still protects the session when storage is unavailable', async () => {
    store.failing = true;
    const claim = await freshClaim();

    expect(await claim(reply('e'))).toBe(true);
    expect(await claim(reply('e'))).toBe(false);
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
});
