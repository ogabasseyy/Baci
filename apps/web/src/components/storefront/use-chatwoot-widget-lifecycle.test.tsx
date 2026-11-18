// @vitest-environment-options {"url":"https://shop.example.com"}
import { act, cleanup, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, resetChatwootGlobals } from './chatwoot-widget.test-support';
import { useChatwootWidgetLifecycle } from './use-chatwoot-widget-lifecycle';

vi.mock('next/navigation', () => ({ usePathname: () => '/shop' }));
vi.mock('./reload-chatwoot-tenant-document', () => ({
  reloadChatwootTenantDocument: vi.fn(),
}));

beforeEach(resetChatwootGlobals);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useChatwootWidgetLifecycle', () => {
  it('stays inactive and loads nothing without a tenant config', () => {
    const { result } = renderHook(() => useChatwootWidgetLifecycle(null));

    expect(result.current).toBe(false);
    expect(document.getElementById('baci-chatwoot-sdk')).toBeNull();
  });

  it('becomes active only after the SDK runs and reports ready', () => {
    const w = window as Window & {
      chatwootSDK?: { run: (o: Record<string, string>) => void };
      $chatwoot?: Record<string, unknown>;
    };
    w.chatwootSDK = {
      run: ({ websiteToken, baseUrl }) => {
        w.$chatwoot = { websiteToken, baseUrl };
      },
    };

    const { result } = renderHook(() => useChatwootWidgetLifecycle(config));
    fireEvent.load(document.getElementById('baci-chatwoot-sdk') as HTMLElement);
    expect(result.current).toBe(false);

    act(() => {
      window.dispatchEvent(new Event('chatwoot:ready'));
    });

    expect(result.current).toBe(true);
  });

  it('ignores a pre-existing unowned widget even when toggleBubbleVisibility throws', () => {
    const toggleBubbleVisibility = vi.fn(() => {
      throw new Error('bubble holder missing');
    });
    (
      window as Window & {
        $chatwoot?: { toggleBubbleVisibility?: (v: 'show' | 'hide') => void };
      }
    ).$chatwoot = { toggleBubbleVisibility };

    const { result } = renderHook(() => useChatwootWidgetLifecycle(config));

    expect(toggleBubbleVisibility).toHaveBeenCalledWith('hide');
    expect(result.current).toBe(false);
    expect(document.getElementById('baci-chatwoot-sdk')).toBeNull();
  });

  it('ignores an unowned widget appearing before SDK run even when hide throws', () => {
    const toggleBubbleVisibility = vi.fn(() => {
      throw new Error('bubble holder missing');
    });
    const run = vi.fn();
    const w = window as Window & {
      chatwootSDK?: { run: (o: Record<string, string>) => void };
      $chatwoot?: { toggleBubbleVisibility?: (v: 'show' | 'hide') => void };
    };
    w.chatwootSDK = { run };

    const { result } = renderHook(() => useChatwootWidgetLifecycle(config));
    w.$chatwoot = { toggleBubbleVisibility };
    fireEvent.load(document.getElementById('baci-chatwoot-sdk') as HTMLElement);

    expect(toggleBubbleVisibility).toHaveBeenCalledWith('hide');
    expect(run).not.toHaveBeenCalled();
    expect(result.current).toBe(false);
  });
});
