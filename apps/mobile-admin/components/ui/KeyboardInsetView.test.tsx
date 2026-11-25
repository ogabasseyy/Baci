import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ progress: 0 }));

vi.mock('react-native-keyboard-controller', () => ({
  useReanimatedKeyboardAnimation: () => ({
    progress: { value: mocks.progress },
  }),
}));
vi.mock('react-native-reanimated', () => ({
  default: {
    View: ({ children, style }: { children?: ReactNode; style?: unknown }) => (
      <div data-style={JSON.stringify(style)} data-testid="animated-view">
        {children}
      </div>
    ),
  },
  interpolate: (value: number, _input: number[], output: number[]) =>
    output[0] + (output[1] - output[0]) * value,
  useAnimatedStyle: (factory: () => unknown) => factory(),
}));

import { KeyboardInsetView } from './KeyboardInsetView';

const styleOf = () =>
  JSON.parse(
    screen.getByTestId('animated-view').getAttribute('data-style') ?? '[]'
  ) as Record<string, unknown>[];

beforeEach(() => {
  mocks.progress = 0;
});

describe('KeyboardInsetView', () => {
  it('keeps the resting padding while the keyboard is down', () => {
    render(
      <KeyboardInsetView opened={8} resting={34}>
        <span>Reply box</span>
      </KeyboardInsetView>
    );

    expect(styleOf()).toContainEqual({ paddingBottom: 34 });
    expect(screen.getByText('Reply box')).toBeTruthy();
  });

  it('eases to the small gap as the keyboard comes up, with the keyboard', () => {
    mocks.progress = 0.5;
    render(
      <KeyboardInsetView opened={8} resting={34}>
        <span>Reply box</span>
      </KeyboardInsetView>
    );
    expect(styleOf()).toContainEqual({ paddingBottom: 21 });
  });

  it('reaches the small gap with the keyboard fully up', () => {
    mocks.progress = 1;
    render(
      <KeyboardInsetView opened={8} resting={34}>
        <span>Reply box</span>
      </KeyboardInsetView>
    );
    expect(styleOf()).toContainEqual({ paddingBottom: 8 });
  });

  it('can ease the offset from the bottom instead, for a floating view', () => {
    mocks.progress = 1;
    render(
      <KeyboardInsetView opened={8} property="bottom" resting={34}>
        <span>Search</span>
      </KeyboardInsetView>
    );
    expect(styleOf()).toContainEqual({ bottom: 8 });
  });
});
