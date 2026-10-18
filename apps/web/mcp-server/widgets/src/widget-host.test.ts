import { afterEach, expect, it, vi } from 'vitest';
import {
  getWidgetHost,
  resetWidgetHost,
  updateWidgetHost,
} from './widget-host';
afterEach(() => {
  resetWidgetHost();
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
  updateWidgetHost({ theme: 'dark' });
  native.widgetState = { count: 2 };
  expect(getWidgetHost()?.widgetState).toEqual({ count: 2 });
  expect(getWidgetHost()?.locale).toBe('count-2');
  getWidgetHost()?.setWidgetState?.({ count: 3 });
  expect(native.widgetState).toEqual({ count: 3 });
  window.openai = { locale: 'en-NG' };
  expect(getWidgetHost()?.locale).toBe('en-NG');
  expect(getWidgetHost()?.theme).toBe('dark');
});
it('keeps explicit undefined overrides instead of restoring unsupported methods', () => {
  window.openai = { callTool: vi.fn() };
  updateWidgetHost({ callTool: undefined });
  expect(getWidgetHost()?.callTool).toBeUndefined();
});
