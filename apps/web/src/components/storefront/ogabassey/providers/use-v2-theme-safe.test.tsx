import { renderHook } from '@testing-library/react';
import type React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useV2ThemeSafe } from './use-v2-theme-safe';
import { V2ThemeProvider } from './v2-theme-context';

describe('useV2ThemeSafe', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('falls back safely to standard theme when rendered outside V2ThemeProvider', () => {
    const { result } = renderHook(() => useV2ThemeSafe());
    expect(result.current).toEqual({ theme: 'standard' });
  });

  it('reads the theme from V2ThemeProvider when present', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 11, 15));

    const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
      <V2ThemeProvider initialTheme="santa">{children}</V2ThemeProvider>
    );

    const { result } = renderHook(() => useV2ThemeSafe(), { wrapper });
    expect(result.current.theme).toBe('santa');
  });
});
