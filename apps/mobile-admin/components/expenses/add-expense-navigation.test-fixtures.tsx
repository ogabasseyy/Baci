import type { ReactNode } from 'react';
import { vi } from 'vitest';

type PreventRemoveCallback = NonNullable<
  Parameters<typeof import('expo-router/react-navigation').usePreventRemove>[1]
>;

const mocks = vi.hoisted(() => ({
  exitScreen: vi.fn(),
  onRemovePrevented: null as PreventRemoveCallback | null,
  removalPrevented: false,
  router: {
    back: vi.fn(() => {
      if (!mocks.removalPrevented) mocks.exitScreen();
    }),
    canGoBack: vi.fn(() => true),
    replace: vi.fn((_href: string) => {
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
  usePreventRemove: (prevent: boolean, callback: PreventRemoveCallback) => {
    mocks.removalPrevented = prevent;
    mocks.onRemovePrevented = callback;
    return () => {
      mocks.removalPrevented = false;
    };
  },
}));

export function pressNativeBack() {
  if (!mocks.removalPrevented) {
    mocks.exitScreen();
    return;
  }

  mocks.onRemovePrevented?.({
    data: { action: { type: 'GO_BACK' } },
    repeat: () => {
      mocks.removalPrevented = false;
      mocks.exitScreen();
    },
  });
}

export function getExpenseNavigationMocks() {
  return mocks;
}
