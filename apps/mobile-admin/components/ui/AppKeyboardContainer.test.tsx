import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppKeyboardContainer } from './AppKeyboardContainer';

const { mockPlatform } = vi.hoisted(() => ({
  mockPlatform: { OS: 'ios' as 'ios' | 'android' },
}));

function Text({ children }: { children?: React.ReactNode }) {
  return <span>{children}</span>;
}

vi.mock('react-native', async () => {
  const React = await import('react');

  return {
    StatusBar: () => null,
    KeyboardAvoidingView: ({
      behavior,
      children,
      keyboardVerticalOffset,
    }: {
      behavior?: string;
      children?: React.ReactNode;
      keyboardVerticalOffset?: number;
    }) =>
      React.createElement(
        'div',
        {
          'aria-label': 'Keyboard avoiding view',
          'data-behavior': behavior,
          'data-keyboard-offset': keyboardVerticalOffset,
          role: 'region',
        },
        children
      ),
    Platform: mockPlatform,
    ScrollView: ({
      children,
      contentContainerStyle,
      keyboardDismissMode,
      keyboardShouldPersistTaps,
    }: {
      children?: React.ReactNode;
      contentContainerStyle?: unknown;
      keyboardDismissMode?: string;
      keyboardShouldPersistTaps?: string;
    }) =>
      React.createElement(
        'div',
        {
          'aria-label': 'Keyboard scroll view',
          'data-content-container-style': JSON.stringify(contentContainerStyle),
          'data-keyboard-dismiss-mode': keyboardDismissMode,
          'data-keyboard-taps': keyboardShouldPersistTaps,
          role: 'region',
        },
        children
      ),
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
    },
    View: ({
      children,
      style,
    }: {
      children?: React.ReactNode;
      style?: unknown;
    }) =>
      React.createElement(
        'div',
        {
          'aria-label': 'Keyboard content',
          'data-style': JSON.stringify(style),
          role: 'region',
        },
        children
      ),
  };
});

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 12, left: 0 }),
}));

afterEach(() => {
  mockPlatform.OS = 'ios';
});

describe('AppKeyboardContainer', () => {
  it('renders children inside the shared keyboard-safe wrappers', () => {
    render(
      <AppKeyboardContainer align="center">
        <Text>Keyboard-safe child</Text>
      </AppKeyboardContainer>
    );

    expect(
      screen.getByRole('region', { name: 'Keyboard avoiding view' })
    ).toBeTruthy();
    expect(
      screen.getByRole('region', { name: 'Keyboard scroll view' })
    ).toBeTruthy();
    expect(screen.getByText('Keyboard-safe child')).toBeTruthy();
  });

  it('applies the shared iOS keyboard behavior contract', () => {
    render(
      <AppKeyboardContainer keyboardVerticalOffset={48}>
        <Text>Contract</Text>
      </AppKeyboardContainer>
    );

    const wrapper = screen.getByRole('region', {
      name: 'Keyboard avoiding view',
    });
    const scrollView = screen.getByRole('region', {
      name: 'Keyboard scroll view',
    });

    expect(wrapper.getAttribute('data-behavior')).toBe('padding');
    expect(wrapper.getAttribute('data-keyboard-offset')).toBe('48');
    expect(scrollView.getAttribute('data-keyboard-dismiss-mode')).toBe(
      'interactive'
    );
    expect(scrollView.getAttribute('data-keyboard-taps')).toBe('handled');
  });

  it('applies the shared Android keyboard behavior contract', () => {
    mockPlatform.OS = 'android';

    render(
      <AppKeyboardContainer keyboardVerticalOffset={24}>
        <Text>Android contract</Text>
      </AppKeyboardContainer>
    );

    const wrapper = screen.getByRole('region', {
      name: 'Keyboard avoiding view',
    });
    const scrollView = screen.getByRole('region', {
      name: 'Keyboard scroll view',
    });

    expect(wrapper.getAttribute('data-behavior')).toBe('height');
    expect(wrapper.getAttribute('data-keyboard-offset')).toBe('24');
    expect(scrollView.getAttribute('data-keyboard-dismiss-mode')).toBe(
      'on-drag'
    );
    expect(scrollView.getAttribute('data-keyboard-taps')).toBe('handled');
  });

  it('applies compact header offset preset for Android', () => {
    mockPlatform.OS = 'android';

    render(
      <AppKeyboardContainer offsetPreset="compactHeader">
        <Text>Compact header</Text>
      </AppKeyboardContainer>
    );

    const wrapper = screen.getByRole('region', {
      name: 'Keyboard avoiding view',
    });

    expect(wrapper.getAttribute('data-keyboard-offset')).toBe('16');
  });

  it('includes safe-area bottom padding in the scroll content style', () => {
    render(
      <AppKeyboardContainer>
        <Text>Inset check</Text>
      </AppKeyboardContainer>
    );

    const scrollView = screen.getByRole('region', {
      name: 'Keyboard scroll view',
    });
    const contentContainer = JSON.parse(
      scrollView.getAttribute('data-content-container-style') ?? '[]'
    ) as Record<string, unknown>[];
    const resolvedStyle = contentContainer.find(
      (value) => typeof value?.paddingBottom === 'number'
    );

    expect(resolvedStyle?.paddingBottom).toBe(16);
  });

  describe('bugfix: a sheet on the bottom edge left a gap under it', () => {
    const scrollStyle = () =>
      JSON.parse(
        screen
          .getByRole('region', { name: 'Keyboard scroll view' })
          .getAttribute('data-content-container-style') ?? '[]'
      ) as Record<string, unknown>[];

    it('paints the bottom safe area in the fill colour instead of leaving it empty', () => {
      render(
        <AppKeyboardContainer bottomFillColor="#ffffff">
          <Text>Sheet</Text>
        </AppKeyboardContainer>
      );

      const padding = scrollStyle().find(
        (value) => typeof value?.paddingBottom === 'number'
      );
      const strip = screen
        .getAllByRole('region', { name: 'Keyboard content' })
        .map((el) => JSON.parse(el.getAttribute('data-style') ?? '{}'));

      expect(padding?.paddingBottom).toBe(0);
      // The strip is as tall as the space it replaces (the safe-area inset 12
      // is below the 16 minimum).
      expect(strip).toContainEqual({ backgroundColor: '#ffffff', height: 16 });
    });

    it('keeps the plain padding and adds no strip without a fill colour', () => {
      render(
        <AppKeyboardContainer>
          <Text>Dialog</Text>
        </AppKeyboardContainer>
      );

      const padding = scrollStyle().find(
        (value) => typeof value?.paddingBottom === 'number'
      );

      expect(padding?.paddingBottom).toBe(16);
      expect(
        screen.queryAllByRole('region', { name: 'Keyboard content' })
      ).toHaveLength(0);
    });

    it('also fills the strip when scrolling is disabled', () => {
      render(
        <AppKeyboardContainer bottomFillColor="#eeeeee" scrollEnabled={false}>
          <Text>Sheet</Text>
        </AppKeyboardContainer>
      );

      const views = screen
        .getAllByRole('region', { name: 'Keyboard content' })
        .map((el) => JSON.parse(el.getAttribute('data-style') ?? '{}'));

      expect(views).toContainEqual({ backgroundColor: '#eeeeee', height: 16 });
    });
  });

  it('top-aligns content when align is start', () => {
    render(
      <AppKeyboardContainer align="start">
        <Text>Top aligned</Text>
      </AppKeyboardContainer>
    );

    const scrollView = screen.getByRole('region', {
      name: 'Keyboard scroll view',
    });
    const contentContainer = JSON.parse(
      scrollView.getAttribute('data-content-container-style') ?? '[]'
    ) as Record<string, unknown>[];
    const resolvedStyle = contentContainer.find(
      (value) => typeof value?.justifyContent === 'string'
    );

    expect(resolvedStyle?.justifyContent).toBe('flex-start');
  });

  it('renders a non-scroll content view when scrolling is disabled', () => {
    render(
      <AppKeyboardContainer scrollEnabled={false}>
        <Text>No scroll</Text>
      </AppKeyboardContainer>
    );

    expect(
      screen.getByRole('region', { name: 'Keyboard content' })
    ).toBeTruthy();
    expect(
      screen.queryByRole('region', { name: 'Keyboard scroll view' })
    ).toBeNull();
    expect(screen.getByText('No scroll')).toBeTruthy();
  });
});
