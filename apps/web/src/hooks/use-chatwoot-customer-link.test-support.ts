import { vi } from 'vitest';

export const setNote = vi.fn();
export const deleteNote = vi.fn();
export const MARKER = 'baci-chat-link:ogabassey';

export const json = (status: number, body: unknown = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(body),
});

type CrossTabListener = (source: 'notice' | 'resume') => void;
const crossTabListeners: CrossTabListener[] = [];
const identityListeners: Array<() => void> = [];

/** Simulates another tab's notice, or ('resume') this tab being refocused. */
export const notifyOtherTab = (source: 'notice' | 'resume' = 'notice') => {
  for (const listener of [...crossTabListeners]) listener(source);
};

/** Simulates the auth context publishing an identity change. */
export const publishIdentity = () => {
  for (const listener of [...identityListeners]) listener();
};

export const listenerCounts = () => ({
  identity: identityListeners.length,
  crossTab: crossTabListeners.length,
});

type Mocks = {
  hint: ReturnType<typeof vi.fn>;
  live: ReturnType<typeof vi.fn>;
  crossTab: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
};

/** Fresh widget, storage, session hint and identity subscriptions per test. */
export function installHarness(mocks: Mocks): void {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  window.localStorage.clear();
  // biome-ignore lint/suspicious/noDocumentCookie: test cleanup of the marker cookie
  document.cookie = 'baci_chat_link_ogabassey=; Path=/; Max-Age=0';
  (window as unknown as { $chatwoot: unknown }).$chatwoot = {
    setConversationCustomAttributes: setNote,
    deleteConversationCustomAttribute: deleteNote,
  };
  mocks.hint.mockReturnValue('1');
  mocks.live.mockReturnValue({
    customerId: 'c1',
    merchantSlug: 'ogabassey',
    userId: 'u1',
  });
  identityListeners.length = 0;
  crossTabListeners.length = 0;
  mocks.crossTab.mockImplementation((listener: CrossTabListener) => {
    crossTabListeners.push(listener);
    return {
      available: true,
      unsubscribe: () => {
        crossTabListeners.splice(crossTabListeners.indexOf(listener), 1);
      },
    };
  });
  mocks.subscribe.mockImplementation((listener: () => void) => {
    identityListeners.push(listener);
    return () => {
      identityListeners.splice(identityListeners.indexOf(listener), 1);
    };
  });
}

export function uninstallHarness(): void {
  vi.useRealTimers();
  delete (window as unknown as { $chatwoot?: unknown }).$chatwoot;
}
