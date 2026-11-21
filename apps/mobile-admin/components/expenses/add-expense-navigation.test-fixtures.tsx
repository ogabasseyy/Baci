import type { ReactNode } from 'react';
import { vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exitScreen: vi.fn(),
  removalPrevented: false,
  router: {
    back: vi.fn(() => {
      if (!mocks.removalPrevented) mocks.exitScreen();
    }),
  },
}));

vi.mock('expo-router', () => ({
  Stack: {
    Screen: ({ options }: { options?: { headerLeft?: () => ReactNode } }) => (
      <>{options?.headerLeft?.()}</>
    ),
  },
  useRouter: () => mocks.router,
}));

vi.mock('expo-router/react-navigation', () => ({
  usePreventRemove: (prevent: boolean) => {
    mocks.removalPrevented = prevent;
    return () => {
      mocks.removalPrevented = false;
    };
  },
}));

export function getExpenseNavigationMocks() {
  return mocks;
}
