import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ headerHeight: 112 }));

vi.mock('expo-router/react-navigation', () => ({
  useHeaderHeight: () => mocks.headerHeight,
}));
vi.mock('react-native-keyboard-controller', () => ({
  KeyboardAvoidingView: ({
    behavior,
    children,
    keyboardVerticalOffset,
  }: {
    behavior?: string;
    children: ReactNode;
    keyboardVerticalOffset?: number;
  }) => (
    <section
      aria-label="Keyboard avoiding view"
      data-behavior={behavior}
      data-offset={keyboardVerticalOffset}
    >
      {children}
    </section>
  ),
}));

import { HeaderKeyboardAvoidingView } from './HeaderKeyboardAvoidingView';

describe('HeaderKeyboardAvoidingView', () => {
  it('lifts by the keyboard, with the header height as the offset above the view', () => {
    render(
      <HeaderKeyboardAvoidingView>
        <span>Under a header</span>
      </HeaderKeyboardAvoidingView>
    );

    const view = screen.getByRole('region', { name: 'Keyboard avoiding view' });
    expect(view.getAttribute('data-behavior')).toBe('padding');
    expect(view.getAttribute('data-offset')).toBe('112');
    expect(screen.getByText('Under a header')).toBeTruthy();
  });

  it('follows the header when its height changes', () => {
    mocks.headerHeight = 150;
    render(
      <HeaderKeyboardAvoidingView>
        <span>Taller header</span>
      </HeaderKeyboardAvoidingView>
    );

    expect(
      screen
        .getByRole('region', { name: 'Keyboard avoiding view' })
        .getAttribute('data-offset')
    ).toBe('150');
  });
});
