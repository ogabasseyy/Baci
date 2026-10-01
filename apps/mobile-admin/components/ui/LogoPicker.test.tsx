import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { LogoPicker } from './LogoPicker';

vi.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: () => null,
  default: () => null,
  __esModule: true,
}));

vi.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: vi.fn(),
}));

vi.mock('@/components/ui/SafeImage', async () => {
  const React = await import('react');

  return {
    default: ({
      fallbackSource,
      resizeMethod,
      source,
    }: {
      fallbackSource?: unknown;
      resizeMethod?: string;
      source?: unknown;
    }) =>
      React.createElement('span', {
        'aria-label': 'store logo',
        'data-fallback-source': JSON.stringify(fallbackSource),
        'data-resize-method': resizeMethod,
        'data-source': JSON.stringify(source),
        role: 'img',
      }),
  };
});

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      border: '#e2e8f0',
      primary: '#2563eb',
      textOnPrimary: '#f8fafc',
      textSecondary: '#64748b',
    },
  }),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    storage: {
      from: vi.fn(() => ({
        getPublicUrl: vi.fn(() => ({
          data: { publicUrl: 'https://cdn.test/logo.png' },
        })),
        upload: vi.fn(() => Promise.resolve({ error: null })),
      })),
    },
  },
}));

vi.mock('@/lib/upload/readUploadBytes', () => ({
  readUploadBytes: vi.fn().mockResolvedValue(new ArrayBuffer(1)),
}));

vi.mock('react-native', async () => {
  const React = await import('react');

  return {
    ActivityIndicator: () => React.createElement('span', null, 'Loading'),
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
          onClick: onPress,
          type: 'button',
        },
        children
      ),
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
    },
    Text: ({
      children,
      style,
    }: {
      children?: React.ReactNode;
      style?: unknown;
    }) =>
      React.createElement(
        'span',
        { 'data-style': JSON.stringify(style) },
        children
      ),
    View: ({ children }: { children?: React.ReactNode; style?: unknown }) =>
      React.createElement('div', null, children),
  };
});

describe('LogoPicker', () => {
  it('uses the theme textOnPrimary token for generated logo initials', () => {
    render(
      <LogoPicker
        businessName="Baci"
        cachedLogoUri={null}
        fallbackLogoUri={null}
        merchantId="merchant-1"
        onStatusChange={vi.fn()}
        onUploadSuccess={vi.fn()}
      />
    );

    expect(screen.getByText('B').getAttribute('data-style')).toContain(
      '"color":"#f8fafc"'
    );
  });

  it('requests bounded bitmap decoding for the store logo', () => {
    render(
      <LogoPicker
        businessName="Baci"
        cachedLogoUri="https://example.com/logo.png"
        fallbackLogoUri="https://example.com/original-logo.png"
        merchantId="merchant-1"
        onStatusChange={vi.fn()}
        onUploadSuccess={vi.fn()}
      />
    );

    expect(screen.getByRole('img', { name: 'store logo' })).toHaveAttribute(
      'data-resize-method',
      'resize'
    );
    expect(screen.getByRole('img', { name: 'store logo' })).toHaveAttribute(
      'data-fallback-source',
      JSON.stringify({ uri: 'https://example.com/original-logo.png' })
    );
  });
});
