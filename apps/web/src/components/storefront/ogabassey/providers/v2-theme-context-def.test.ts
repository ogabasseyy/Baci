import { describe, expect, it } from 'vitest';
import {
  V2ThemeContext,
  getNoTheme,
  subscribeToMissingTheme,
} from './v2-theme-context-def';

describe('v2-theme-context-def', () => {
  it('provides getNoTheme snapshot fallback returning null', () => {
    expect(getNoTheme()).toBeNull();
  });

  it('provides subscribeToMissingTheme fallback returning a no-op unsubscribe function', () => {
    const unsubscribe = subscribeToMissingTheme();
    expect(typeof unsubscribe).toBe('function');
    expect(unsubscribe()).toBeUndefined();
  });

  it('defines V2ThemeContext with undefined default value', () => {
    expect(V2ThemeContext).toBeDefined();
    // React Context objects expose _currentValue for default initial value in React 19 / test environments
    // or when consumed outside a provider
    const defaultValue = (V2ThemeContext as unknown as { _currentValue: unknown })._currentValue;
    expect(defaultValue).toBeUndefined();
  });
});
