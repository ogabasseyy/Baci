import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));
vi.mock('./HeaderKeyboardAvoidingView', () => ({
  HeaderKeyboardAvoidingView: ({ children }: { children?: ReactNode }) => (
    <section aria-label="Header keyboard view">{children}</section>
  ),
}));
vi.mock('./KeyboardInsetView', () => ({
  KeyboardInsetView: ({
    children,
    opened,
    resting,
  }: {
    children?: ReactNode;
    opened: number;
    resting: number;
  }) => (
    <div data-opened={opened} data-resting={resting} data-testid="inset-view">
      {children}
    </div>
  ),
}));

import { AppHeaderKeyboardContainer } from './AppHeaderKeyboardContainer';

describe('AppHeaderKeyboardContainer', () => {
  it('puts its content in the header-aware keyboard view', () => {
    render(
      <AppHeaderKeyboardContainer>
        <span>Reply box</span>
      </AppHeaderKeyboardContainer>
    );

    expect(
      screen.getByRole('region', { name: 'Header keyboard view' })
    ).toBeTruthy();
    expect(screen.getByText('Reply box')).toBeTruthy();
  });

  it('eases the safe-area spacing down to a small gap as the keyboard rises', () => {
    render(
      <AppHeaderKeyboardContainer>
        <span>Reply box</span>
      </AppHeaderKeyboardContainer>
    );

    const inset = screen.getByTestId('inset-view');
    expect(inset.getAttribute('data-resting')).toBe('34');
    expect(inset.getAttribute('data-opened')).toBe('8');
  });

  it('lets a screen that lays out its own bottom edge take the padding away', () => {
    render(
      <AppHeaderKeyboardContainer contentContainerStyle={{ paddingBottom: 0 }}>
        <span>Own bottom edge</span>
      </AppHeaderKeyboardContainer>
    );

    const inset = screen.getByTestId('inset-view');
    expect(inset.getAttribute('data-resting')).toBe('0');
    expect(inset.getAttribute('data-opened')).toBe('0');
  });
});
