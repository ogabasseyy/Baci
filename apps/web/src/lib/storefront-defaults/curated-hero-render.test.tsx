import type { PuckContext } from '@puckeditor/core';
import { render, screen } from '@testing-library/react';
import { colord } from 'colord';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { getContrastRatio } from '@/lib/color-utils';
import { buildCuratedCopy } from './build-curated-copy';
import { buildCuratedHero } from './build-curated-hero';
import { getCuratedThemeTokenProjection } from './curated-theme-token-projection';
import { deriveCuratedTheme } from './derive-curated-theme';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: () => ({ basePath: '' }),
}));

const { builderConfig } = await import('@/components/builder/config');

type BuilderRenderProps<T> = T extends {
  render?: (props: infer Props) => ReactNode;
}
  ? Props
  : never;

const puck = {
  renderDropZone: () => null,
  metadata: {},
  isEditing: false,
  dragRef: null,
} satisfies PuckContext;

it.each([
  'fashion',
  'food',
  'electronics',
  'pharmacy',
  'unknown-type',
])('renders the generated category gradient on the Hero section for %s', (businessType) => {
  const hero = buildCuratedHero(
    businessType,
    buildCuratedCopy({
      businessName: 'North Star',
      businessType,
      country: 'Nigeria',
    }).hero
  );
  const heroProps = { ...hero, puck } satisfies BuilderRenderProps<
    typeof builderConfig.components.Hero
  >;
  const { container } = render(builderConfig.components.Hero.render(heroProps));
  expect(container.querySelector('section')).toHaveStyle({
    backgroundImage: hero.backgroundGradient,
  });
  expect(
    screen.getByRole('link', { name: 'Explore products' })
  ).toHaveAttribute('href', '#products');
});

const scrimmed = (color: string, overlay: string) => {
  const rgb = colord(color).toRgb();
  const scrim = colord(overlay).toRgb();
  return colord({
    r: Math.round(rgb.r * 0.4 + scrim.r * 0.6),
    g: Math.round(rgb.g * 0.4 + scrim.g * 0.6),
    b: Math.round(rgb.b * 0.4 + scrim.b * 0.6),
  }).toHex();
};

type HeroSurfaceCase = {
  businessType: string;
  brandColors: { primary: string; accent: string; background: string };
  endpointNames: Array<'primary' | 'accent' | 'background'>;
};

const adversarialHeroThemes: HeroSurfaceCase[] = [
  {
    businessType: 'fashion',
    brandColors: {
      primary: '#000000',
      accent: '#FFFFFF',
      background: '#FFFFFF',
    },
    endpointNames: ['primary', 'accent'],
  },
  {
    businessType: 'food',
    brandColors: {
      primary: '#000000',
      accent: '#FFFFFF',
      background: '#FFFFFF',
    },
    endpointNames: ['accent', 'background'],
  },
  {
    businessType: 'electronics',
    brandColors: {
      primary: '#FFFFFF',
      accent: '#000000',
      background: '#000000',
    },
    endpointNames: ['primary', 'background'],
  },
  {
    businessType: 'pharmacy',
    brandColors: {
      primary: '#000000',
      accent: '#FFFFFF',
      background: '#101010',
    },
    endpointNames: ['accent', 'primary'],
  },
  {
    businessType: 'unknown-type',
    brandColors: {
      primary: '#FFFFFF',
      accent: '#000000',
      background: '#FFFFFF',
    },
    endpointNames: ['background', 'primary'],
  },
];

it.each(
  adversarialHeroThemes
)('renders an AA-readable Hero surface for $businessType with its actual adversarial theme endpoints', ({
  businessType,
  brandColors,
  endpointNames,
}) => {
  const theme = deriveCuratedTheme(brandColors, businessType);
  const hero = buildCuratedHero(
    businessType,
    buildCuratedCopy({
      businessName: 'North Star',
      businessType,
      country: 'Nigeria',
    }).hero
  );
  const heroProps = { ...hero, puck } satisfies BuilderRenderProps<
    typeof builderConfig.components.Hero
  >;
  const tokens = getCuratedThemeTokenProjection(theme);
  const { container } = render(
    <div
      style={
        {
          ...tokens,
          '--store-primary': theme.colors.primary,
          '--store-accent': theme.colors.accent,
          '--store-background': theme.colors.background,
        } as React.CSSProperties
      }
    >
      {builderConfig.components.Hero.render(heroProps)}
    </div>
  );

  expect(container.querySelector('[aria-hidden="true"]')).toHaveStyle({
    backgroundColor: 'var(--theme-hero-overlay, var(--theme-foreground))',
    opacity: '0.6',
  });
  expect(container.firstElementChild).toHaveStyle({
    '--store-primary': theme.colors.primary,
    '--store-accent': theme.colors.accent,
    '--store-background': theme.colors.background,
  });
  expect(container.querySelector('section')).toHaveStyle({
    backgroundImage: hero.backgroundGradient,
  });
  expect(screen.getByRole('heading', { level: 1 }).parentElement).toHaveStyle({
    color: 'var(--theme-hero-foreground, var(--theme-background))',
  });
  for (const endpointName of endpointNames)
    expect(
      getContrastRatio(
        tokens['--theme-hero-foreground'],
        scrimmed(theme.colors[endpointName], tokens['--theme-hero-overlay'])
      )
    ).toBeGreaterThanOrEqual(4.5);
});

it('renders the starter heading hierarchy through real Builder components', () => {
  const hero = buildCuratedHero(
    'fashion',
    buildCuratedCopy({
      businessName: 'North Star',
      businessType: 'fashion',
      country: 'Nigeria',
    }).hero
  );
  const heroProps = { ...hero, puck } satisfies BuilderRenderProps<
    typeof builderConfig.components.Hero
  >;
  const text = {
    id: 'Text-story',
    title: 'About North Star',
    content: 'Browse.',
    align: 'center',
    puck,
  } satisfies BuilderRenderProps<typeof builderConfig.components.Text>;
  const features = {
    id: 'Features-trust',
    title: 'Browse styles',
    features: [{ title: 'Browse', description: 'Browse.', icon: 'search' }],
    puck,
  } satisfies BuilderRenderProps<typeof builderConfig.components.Features>;
  const { container } = render(
    <>
      {builderConfig.components.Hero.render(heroProps)}
      {builderConfig.components.Text.render(text)}
      {builderConfig.components.Features.render(features)}
    </>
  );

  expect(container.querySelector('h1')).toHaveTextContent(
    'Explore styles from North Star'
  );
  expect(container.querySelector('h2')).toHaveTextContent('About North Star');
  expect(container.querySelector('h3')).toHaveTextContent('Browse');
});
