import { vi } from 'vitest';

export const setCustomAttributes = vi.fn();
export const deleteCustomAttribute = vi.fn();
export const MARKER = 'baci-chat-link:ogabassey';

export const json = (status: number, body: unknown = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(body),
});

const crossTabListeners: Array<() => void> = [];
const identityListeners: Array<() => void> = [];

/** Simulates a notice from another tab (or a focus/visibility event). */
export const notifyOtherTab = () => {
  for (const listener of [...crossTabListeners]) listener();
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
  (window as unknown as { $chatwoot: unknown }).$chatwoot = {
    setCustomAttributes,
    deleteCustomAttribute,
  };
  mocks.hint.mockReturnValue('1');
  mocks.live.mockReturnValue({
    customerId: 'c1',
    merchantSlug: 'ogabassey',
    userId: 'u1',
  });
  identityListeners.length = 0;
  crossTabListeners.length = 0;
  mocks.crossTab.mockImplementation((listener: () => void) => {
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
