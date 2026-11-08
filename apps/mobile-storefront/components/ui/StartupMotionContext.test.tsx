import { renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import {
  StartupMotionProvider,
  useStartupMotionEnabled,
} from './StartupMotionContext';

it('enables motion by default', () => {
  expect(renderHook(() => useStartupMotionEnabled()).result.current).toBe(true);
});
it.each([true, false])('provides motion enabled=%s', (enabled) => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StartupMotionProvider enabled={enabled}>{children}</StartupMotionProvider>
  );
  expect(
    renderHook(() => useStartupMotionEnabled(), { wrapper }).result.current
  ).toBe(enabled);
});
