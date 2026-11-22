import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getConversationSnapshot,
  postAssistantMessage,
  setConversationLabels,
  setConversationStatus,
} from './chat-auto-reply-client';
import { stubFetch } from './merchant-inbox-client.test-support';

const binding = {
  merchantId: '11111111-1111-4111-8111-111111111111',
  accountId: 2,
  inboxId: 20,
  apiAccessToken: 'synthetic-agent-token-aaaa',
  botApiAccessToken: 'synthetic-bot-token-bbbb',
  apiOrigin: 'https://chat.example.test',
};

afterEach(() => vi.unstubAllGlobals());

const header = (init: unknown) =>
  ((init as RequestInit).headers as Record<string, string>).api_access_token;

describe('chat auto-reply provider client', () => {
  it('posts the reply as the bot, publicly', async () => {
    const fetchMock = stubFetch(() => ({ body: {} }));
    const ok = await postAssistantMessage(binding, {
      conversationId: 7,
      content: 'Hello',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(ok).toBe(true);
    expect(new URL(String(url)).pathname).toBe(
      '/api/v1/accounts/2/conversations/7/messages'
    );
    expect(header(init)).toBe('synthetic-bot-token-bbbb');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      content: 'Hello',
      message_type: 'outgoing',
      private: false,
    });
  });

  it('posts a private note when asked', async () => {
    const fetchMock = stubFetch(() => ({ body: {} }));
    await postAssistantMessage(binding, {
      conversationId: 7,
      content: 'note',
      isPrivate: true,
    });
    const body = JSON.parse(
      String((fetchMock.mock.calls[0][1] as RequestInit).body)
    );
    expect(body.private).toBe(true);
  });

  it('moves the status as the bot', async () => {
    const fetchMock = stubFetch(() => ({ body: {} }));
    await setConversationStatus(binding, { conversationId: 7, status: 'open' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(String(url)).pathname).toBe(
      '/api/v1/accounts/2/conversations/7/toggle_status'
    );
    expect(header(init)).toBe('synthetic-bot-token-bbbb');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      status: 'open',
    });
  });

  it('moves the status with the inbox credential when the bot credential is refused', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = stubFetch((_url, init) =>
      header(init) === 'synthetic-bot-token-bbbb'
        ? { status: 401 }
        : { body: {} }
    );
    expect(
      await setConversationStatus(binding, {
        conversationId: 7,
        status: 'open',
      })
    ).toBe(true);
    expect(fetchMock.mock.calls.map(([, init]) => header(init))).toEqual([
      'synthetic-bot-token-bbbb',
      'synthetic-agent-token-aaaa',
    ]);
  });

  it('does not retry a status move that timed out or hit a server error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = stubFetch(() => ({ status: 500 }));
    expect(
      await setConversationStatus(binding, {
        conversationId: 7,
        status: 'open',
      })
    ).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sets labels with the agent credential', async () => {
    const fetchMock = stubFetch(() => ({ body: {} }));
    await setConversationLabels(binding, {
      conversationId: 7,
      labels: ['handled-by-ai'],
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(String(url)).pathname).toBe(
      '/api/v1/accounts/2/conversations/7/labels'
    );
    expect(header(init)).toBe('synthetic-agent-token-aaaa');
  });

  it('reports a refusal or an outage as false, without logging secrets', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    stubFetch(() => ({ status: 401 }));
    expect(
      await postAssistantMessage(binding, { conversationId: 7, content: 'x' })
    ).toBe(false);
    stubFetch(() => new Error('down'));
    expect(
      await setConversationStatus(binding, {
        conversationId: 7,
        status: 'open',
      })
    ).toBe(false);
    expect(JSON.stringify(error.mock.calls)).not.toContain('synthetic-');
    expect(JSON.stringify(error.mock.calls)).toContain('/:id/');
  });

  it('reads the live status and labels with the agent credential', async () => {
    const fetchMock = stubFetch(() => ({
      body: { status: 'pending', labels: ['vip'], extra: 1 },
    }));
    expect(await getConversationSnapshot(binding, 7)).toEqual({
      status: 'pending',
      labels: ['vip'],
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(String(url)).pathname).toBe(
      '/api/v1/accounts/2/conversations/7'
    );
    expect((init as RequestInit).method).toBe('GET');
    expect(header(init)).toBe('synthetic-agent-token-aaaa');
  });

  it('returns null when the live conversation cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubFetch(() => ({ status: 500 }));
    expect(await getConversationSnapshot(binding, 7)).toBeNull();
    stubFetch(() => ({ body: { nonsense: true } }));
    expect(await getConversationSnapshot(binding, 7)).toBeNull();
  });
});
