import { act, renderHook } from '@testing-library/react';
import { useEffect, useSyncExternalStore } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stashPrivateParamsForNavigation } from '@/lib/privacy/private-url-param-handoff';
import { currentPrivateParamsId } from '@/lib/privacy/private-url-param-stash';
import {
  usePrivateSearchParams,
  usePrivateSearchParamsState,
} from './use-private-search-params';

vi.mock('next/navigation', () => {
  const subscribe = () => () => {};
  return {
    usePathname: () =>
      useSyncExternalStore(
        subscribe,
        () => window.location.pathname,
        () => '/'
      ),
    useSearchParams: () =>
      new URLSearchParams(
        useSyncExternalStore(
          subscribe,
          () => window.location.search,
          () => ''
        )
      ),
  };
});

const originalReplaceState = window.history.replaceState.bind(window.history);

function visit(url: string) {
  originalReplaceState(null, '', url);
}

interface ProbeLog {
  renders: { token: string | null; isReady: boolean }[];
  effects: (string | null)[];
}

function Probe({ log }: { log: ProbeLog }) {
  const { searchParams, isReady } = usePrivateSearchParamsState();
  const token = searchParams.get('token');
  log.renders.push({ token, isReady });
  useEffect(() => {
    // What a payment/verification effect does: act only once ready.
    if (isReady) log.effects.push(token);
  }, [isReady, token, log]);
  return <p>{token ?? 'no-token'}</p>;
}

beforeEach(() => {
  window.sessionStorage.clear();
});

const roots: Root[] = [];

function hydrate(
  ...args: Parameters<typeof hydrateRoot>
): ReturnType<typeof hydrateRoot> {
  const root = hydrateRoot(...args);
  roots.push(root);
  return root;
}

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  visit('/');
});

describe('bugfix: reloaded scrubbed link hydrated with values the server never rendered', () => {
  function reloadScrubbedLink() {
    visit('/track-order?token=abc&orderId=1');
    renderHook(() => usePrivateSearchParams()).unmount();
    expect(window.location.search).toBe('?orderId=1');
  }

  it('matches the server HTML on the hydrating render, then shows the stashed token without a hydration error', async () => {
    reloadScrubbedLink();
    const log: ProbeLog = { renders: [], effects: [] };
    const container = document.createElement('div');
    document.body.appendChild(container);
    container.innerHTML = renderToString(<Probe log={{ ...log }} />);
    expect(container.textContent).toBe('no-token');
    const onRecoverableError = vi.fn();
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await act(async () => {
      hydrate(container, <Probe log={log} />, { onRecoverableError });
    });

    expect(log.renders[0]).toEqual({ token: null, isReady: false });
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expect(container.textContent).toBe('abc');
  });

  it('lets a value-driven effect act only once, with the stashed values', async () => {
    reloadScrubbedLink();
    const log: ProbeLog = { renders: [], effects: [] };
    const container = document.createElement('div');
    document.body.appendChild(container);
    container.innerHTML = renderToString(<Probe log={{ ...log }} />);

    await act(async () => {
      hydrate(container, <Probe log={log} />);
    });

    expect(log.effects).toEqual(['abc']);
  });

  it('is ready on the first render when the page is not hydrating', () => {
    reloadScrubbedLink();
    const seen: boolean[] = [];

    renderHook(() => {
      const state = usePrivateSearchParamsState();
      seen.push(state.isReady);
      return state;
    });

    expect(seen.every(Boolean)).toBe(true);
  });

  it('reads and claims an off-URL hand-off after a full-page navigation hydrates server HTML', async () => {
    visit('/track-order?orderId=1');
    const cleaned = stashPrivateParamsForNavigation(
      '/track-order?orderId=1&token=abc',
      'shop'
    );
    // Full-page navigation: a new document at the cleaned URL, no history stash id.
    visit(cleaned);
    expect(currentPrivateParamsId()).toBeNull();
    const log: ProbeLog = { renders: [], effects: [] };
    const container = document.createElement('div');
    document.body.appendChild(container);
    container.innerHTML = renderToString(<Probe log={{ ...log }} />);
    const onRecoverableError = vi.fn();

    await act(async () => {
      hydrate(container, <Probe log={log} />, { onRecoverableError });
    });

    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(container.textContent).toBe('abc');
    expect(log.effects).toEqual(['abc']);
    expect(currentPrivateParamsId()).not.toBeNull();
    expect(
      window.sessionStorage.getItem('baci:private-url-params-pending')
    ).toBeNull();
  });
});
