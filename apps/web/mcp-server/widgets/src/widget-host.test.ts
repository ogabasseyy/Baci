import { afterEach, expect, it, vi } from 'vitest';
import { widgetHost } from './widget-host';

afterEach(() => {
  widgetHost.reset();
  delete window.openai;
});
it('reads live native values, getters and prototype methods after standard updates', () => {
  class NativeHost {
    widgetState = { count: 1 };
    get locale() {
      return `count-${this.widgetState.count}`;
    }
    setWidgetState(state: unknown) {
      this.widgetState = state as { count: number };
    }
  }
  const native = new NativeHost();
  window.openai = native;
  widgetHost.update({ theme: 'dark' });
  native.widgetState = { count: 2 };
  expect(widgetHost.get()?.widgetState).toEqual({ count: 2 });
  expect(widgetHost.get()?.locale).toBe('count-2');
  widgetHost.get()?.setWidgetState?.({ count: 3 });
  expect(native.widgetState).toEqual({ count: 3 });
  window.openai = { locale: 'en-NG' };
  expect(widgetHost.get()?.locale).toBe('en-NG');
  expect(widgetHost.get()?.theme).toBe('dark');
});
it('keeps explicit undefined overrides instead of restoring unsupported methods', () => {
  window.openai = { callTool: vi.fn() };
  widgetHost.update({ callTool: undefined });
  expect(widgetHost.get()?.callTool).toBeUndefined();
});

it('replaces adapter widget state when the native host publishes a newer value', () => {
  window.openai = { widgetState: { count: 1 } };
  widgetHost.update({ widgetState: { count: 2 } });

  window.openai.widgetState = { count: 3 };
  window.dispatchEvent(
    new CustomEvent('openai:set_globals', {
      detail: { globals: { widgetState: { count: 3 } } },
    })
  );

  expect(widgetHost.get()?.widgetState).toEqual({ count: 3 });
});

it('notifies subscribers with native values when the adapter resets', () => {
  window.openai = { theme: 'light' };
  widgetHost.update({ theme: 'dark', toolOutput: { products: [] } });
  const seen: Array<Record<string, unknown>> = [];
  const listener = (event: Event) => {
    seen.push({
      ...(event as CustomEvent<{ globals: Record<string, unknown> }>)
        .detail.globals,
    });
  };
  window.addEventListener('openai:set_globals', listener);
  try {
    widgetHost.reset();
  } finally {
    window.removeEventListener('openai:set_globals', listener);
  }
  expect(seen).toHaveLength(1);
  expect(seen[0]?.theme).toBe('light');
  expect(seen[0] && 'toolOutput' in seen[0]).toBe(true);
  expect(widgetHost.get()).toBe(window.openai);
});

it('returns a stable bound reference for native methods', () => {
  window.openai = { requestDisplayMode: () => Promise.resolve({}) };
  widgetHost.update({ theme: 'dark' });
  const first = widgetHost.get()?.requestDisplayMode;
  const second = widgetHost.get()?.requestDisplayMode;
  expect(first).toBe(second);
  expect(first).not.toBe(window.openai.requestDisplayMode);
});

it('dispatches nothing when resetting without adapter state', () => {
  const listener = vi.fn();
  window.addEventListener('openai:set_globals', listener);
  try {
    widgetHost.reset();
  } finally {
    window.removeEventListener('openai:set_globals', listener);
  }
  expect(listener).not.toHaveBeenCalled();
});
