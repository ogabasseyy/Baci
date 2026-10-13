import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ThemeColors } from '@/constants/theme';
import { ProductImageCard } from './ProductImageCard';

vi.mock('@/components/ui/SafeImage', () => ({
  default: ({ source }: { source: { uri: string } }) => (
    <img alt="Product preview" data-src={source.uri} />
  ),
}));

vi.mock('react-native', async () => {
  const React = await import('react');

  return {
    StatusBar: () => null,
    ActivityIndicator: () => React.createElement('span', null, 'Uploading'),
    Pressable: ({
      accessibilityLabel,
      children,
      disabled,
      onPress,
    }: {
      accessibilityLabel?: string;
      children?: React.ReactNode;
      disabled?: boolean;
      onPress?: () => void;
    }) =>
      React.createElement(
        'button',
        {
          'aria-label': accessibilityLabel,
          disabled,
          onClick: () => onPress?.(),
          type: 'button',
        },
        children
      ),
    StyleSheet: {
      absoluteFillObject: {},
      create: (styles: Record<string, unknown>) => styles,
    },
    Text: ({
      accessibilityLabel,
      children,
    }: {
      accessibilityLabel?: string;
      children?: React.ReactNode;
    }) =>
      React.createElement(
        'span',
        { 'aria-label': accessibilityLabel },
        children
      ),
    View: ({
      accessibilityLabel,
      children,
    }: {
      accessibilityLabel?: string;
      children?: React.ReactNode;
    }) =>
      React.createElement(
        'div',
        { 'aria-label': accessibilityLabel },
        children
      ),
  };
});

vi.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: () => null,

  default: () => null,
  __esModule: true,
}));

describe('ProductImageCard', () => {
  const colors = {
    border: '#e2e8f0',
    card: '#ffffff',
    inputBg: '#f8fafc',
    primary: '#2563eb',
    textOnPrimary: '#ffffff',
    textSecondary: '#64748b',
  } as unknown as ThemeColors;

  it('shows the upload placeholder and triggers image selection', () => {
    const onPress = vi.fn();

    render(
      <ProductImageCard colors={colors} isUploading={false} onPress={onPress} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Product image' }));

    expect(screen.getByText('Tap to upload image')).toBeInTheDocument();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders the selected image state', () => {
    render(
      <ProductImageCard
        colors={colors}
        imageUrl="https://example.com/image.jpg"
        isUploading={false}
        onPress={vi.fn()}
      />
    );

    const image = screen.getByRole('img', { name: 'Product preview' });

    expect(image).toHaveAttribute('data-src', 'https://example.com/image.jpg');
    expect(screen.getByText('Change Image')).toBeInTheDocument();
  });

  it('shows a disabled uploading state and ignores presses while uploading', () => {
    const onPress = vi.fn();

    render(
      <ProductImageCard colors={colors} isUploading={true} onPress={onPress} />
    );

    const button = screen.getByRole('button', { name: 'Product image' });

    expect(screen.getByText('Uploading')).toBeInTheDocument();
    expect(button).toBeDisabled();

    fireEvent.click(button);

    expect(onPress).not.toHaveBeenCalled();
  });
});
