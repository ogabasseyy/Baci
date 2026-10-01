import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ProductVariantSelectableGroup } from './ProductVariantSelectableGroup';

vi.mock('react-native', async () => {
  const React = await import('react');
  const flattenStyle = (
    style: Record<string, unknown> | Record<string, unknown>[] | undefined
  ) =>
    Array.isArray(style)
      ? Object.assign({}, ...style.filter(Boolean))
      : (style ?? {});

  return {
    Pressable: ({
      accessibilityLabel,
      accessibilityState,
      children,
      disabled,
      onPress,
    }: {
      accessibilityLabel?: string;
      accessibilityState?: { disabled?: boolean; selected?: boolean };
      children?: ReactNode;
      disabled?: boolean;
      onPress?: () => void;
    }) =>
      React.createElement(
        'button',
        {
          'aria-disabled': disabled || accessibilityState?.disabled,
          'aria-label': accessibilityLabel,
          'aria-pressed': accessibilityState?.selected,
          disabled,
          onClick: () => {
            if (!(disabled || accessibilityState?.disabled)) {
              onPress?.();
            }
          },
          type: 'button',
        },
        children
      ),
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
    },
    Text: ({ children }: { children?: ReactNode }) =>
      React.createElement('span', null, children),
    View: ({
      children,
      style,
      testID,
    }: {
      children?: ReactNode;
      style?: Record<string, unknown> | Record<string, unknown>[];
      testID?: string;
    }) => {
      const flattenedStyle = flattenStyle(style);

      return React.createElement(
        'div',
        { 'data-flex-wrap': flattenedStyle.flexWrap, 'data-testid': testID },
        children
      );
    },
  };
});

const colors = {
  border: '#2f3148',
  card: '#171829',
  primary: '#4f9be8',
  text: '#ffffff',
  textMuted: '#94a3b8',
  textOnPrimary: '#ffffff',
  textSecondary: '#a6adbb',
};

describe('ProductVariantSelectableGroup', () => {
  it('renders selectable variant values in a wrapping row', () => {
    const onSelect = vi.fn();

    render(
      <ProductVariantSelectableGroup
        colors={colors}
        group={{
          key: 'storage',
          label: 'Storage',
          values: [],
        }}
        onSelect={onSelect}
        values={[
          {
            available: true,
            label: '256GB SSD',
            selected: false,
            value: '256GB SSD',
          },
          {
            available: true,
            label: '512GB SSD',
            selected: true,
            value: '512GB SSD',
          },
        ]}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Select Storage 256GB SSD' })
    );

    expect(onSelect).toHaveBeenCalledWith('storage', '256GB SSD');
    expect(
      screen.getByRole('button', { name: 'Select Storage 512GB SSD' })
    ).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('variant-options-storage')).toHaveAttribute(
      'data-flex-wrap',
      'wrap'
    );
  });

  it('lets users switch to an option that will prune conflicting choices', () => {
    const onSelect = vi.fn();

    render(
      <ProductVariantSelectableGroup
        colors={colors}
        group={{
          key: 'storage',
          label: 'Storage',
          values: [],
        }}
        onSelect={onSelect}
        values={[
          {
            available: false,
            label: '128GB SSD',
            selected: false,
            value: '128GB SSD',
          },
        ]}
      />
    );

    const unavailableOption = screen.getByRole('button', {
      name: 'Select Storage 128GB SSD',
    });

    expect(unavailableOption).toBeEnabled();

    fireEvent.click(unavailableOption);

    expect(onSelect).toHaveBeenCalledWith('storage', '128GB SSD');
  });
});
