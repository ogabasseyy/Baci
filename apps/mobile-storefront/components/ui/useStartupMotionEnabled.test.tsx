import { renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { StartupMotionProvider } from './StartupMotionProvider';
import { useStartupMotionEnabled } from './useStartupMotionEnabled';

it('defaults to enabled when no startup motion provider is mounted', () => {
  expect(renderHook(() => useStartupMotionEnabled()).result.current).toBe(true);
});

it('reads the enabled flag from its provider', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StartupMotionProvider enabled={false}>{children}</StartupMotionProvider>
  );
  expect(
    renderHook(() => useStartupMotionEnabled(), { wrapper }).result.current
  ).toBe(false);
});
