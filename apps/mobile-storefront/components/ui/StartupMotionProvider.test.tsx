import { renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { StartupMotionProvider } from './StartupMotionProvider';
import { useStartupMotionEnabled } from './useStartupMotionEnabled';

it.each([true, false])('provides its enabled value (%s)', (enabled) => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StartupMotionProvider enabled={enabled}>{children}</StartupMotionProvider>
  );
  expect(
    renderHook(() => useStartupMotionEnabled(), { wrapper }).result.current
  ).toBe(enabled);
});
