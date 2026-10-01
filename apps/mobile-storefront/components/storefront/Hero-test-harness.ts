import { jest } from '@jest/globals';
import { screen } from '@testing-library/react-native';
import type { HeroSlide } from './Hero';

// Shared mocks, builders, and module factories for the Hero suites (core +
// ad slots + ad timing). Pure module on purpose: jest.mock hoisting is
// per-file, so each suite registers its own mocks from these factories and
// mock handles. Factories are mock-prefixed because factory bodies may only
// reference mock-prefixed imports.

export const mockImage = jest.fn();
export const mockUseMobileAdsReadiness = jest.fn(() => ({
  canRequestAds: true,
  initialized: true,
}));

export function mockExpoImageModule(): unknown {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');

  return {
    Image: (props: Record<string, unknown>) => {
      mockImage(props);
      return React.createElement(View, { ...props, testID: 'hero-image' });
    },
  };
}

export function mockThemeModule(): unknown {
  return {
    useTheme: () => ({
      colors: {
        background: '#ffffff',
        border: '#dddddd',
        card: '#ffffff',
        muted: '#f2f2f2',
        text: '#111111',
        textSecondary: '#666666',
      },
      isDark: false,
    }),
  };
}

export const slide: HeroSlide = {
  ctaLink: '/category/phones',
  ctaText: 'Shop now',
  image: 'https://cdn.ogabassey.com/core-assets/products/hero.avif',
  subtitle: 'Available now',
  title: 'Featured phones',
};

export const baseTemplate = {
  borderRadius: 'md' as const,
  cardVariant: 'grid' as const,
  categoryStyle: 'pill' as const,
  features: {},
  headerStyle: 'standard' as const,
  spacing: 'compact' as const,
};

export function renderedMarkerOrder(): string[] {
  const markers: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const record = node as {
      children?: unknown;
      props?: { accessibilityLabel?: unknown; testID?: unknown };
    };
    const testID = record.props?.testID;
    const label = record.props?.accessibilityLabel;
    if (typeof testID === 'string') markers.push(testID);
    else if (typeof label === 'string') markers.push(label);
    if (record.children !== undefined) walk(record.children);
  };
  walk(screen.toJSON());
  return markers;
}
