import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { getCuratedThemeTokenProjection } from '@/lib/storefront-defaults/curated-theme-token-projection';
import { defaultTheme } from '@/lib/theme-config';
import { HeroPresentation } from './hero-presentation';

it.each([
  'h1',
  'h2',
  'div',
] as const)('preserves %s headings, content and adapter-owned actions', (headingLevel) => {
  const click = vi.fn();
  render(
    <HeroPresentation
      title="Approved heading"
      subtitle="Approved subtitle"
      align="left"
      padding="small"
      headingLevel={headingLevel}
      action={
        <button type="button" onClick={click}>
          Approved action
        </button>
      }
    />
  );
  expect(screen.getByText('Approved heading').tagName).toBe(
    headingLevel.toUpperCase()
  );
  expect(screen.getByText('Approved subtitle')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Approved action' }));
  expect(click).toHaveBeenCalledOnce();
  expect(screen.getByLabelText('Hero Banner')).toHaveStyle({
    paddingBlock: '3rem',
  });
});
it.each([
  ['left', 'flex-start'],
  ['center', 'center'],
  ['right', 'flex-end'],
] as const)('aligns %s content without forcing shaded text on an unshaded image', (align, alignItems) => {
  const { container } = render(
    <HeroPresentation
      title="Heading"
      subtitle="Subtitle"
      align={align}
      padding="large"
      backgroundImage="https://usebaci.com/image.png"
      overlay={false}
      action={null}
    />
  );
  expect(container.querySelector('.baci-overlay')).toBeNull();
  expect(container.querySelector('.baci-hero-content')).toHaveStyle({
    alignItems,
    textAlign: align,
  });
  expect(
    (container.querySelector('.baci-hero-content') as HTMLElement).style.color
  ).toBe('');
  expect(screen.getByLabelText('Hero Banner')).toHaveStyle({
    paddingBlock: '8rem',
  });
});
it.each([
  false,
  true,
])('uses projected merchant hero colors for shaded images/gradients (%s)', (gradient) => {
  const theme = structuredClone(defaultTheme);
  theme.colors.foreground = '#123456';
  theme.colors.background = '#fedcba';
  const tokens = getCuratedThemeTokenProjection(theme);
  expect(tokens['--theme-hero-overlay']).toBe('#123456');
  expect(tokens['--theme-hero-foreground']).toBe('#fedcba');
  const { container } = render(
    <HeroPresentation
      title="Heading"
      subtitle="Subtitle"
      align="center"
      padding="medium"
      backgroundImage={gradient ? undefined : 'https://usebaci.com/image.png'}
      backgroundGradient={gradient ? 'linear-gradient(red, blue)' : undefined}
      overlay
      action={null}
    />
  );
  const overlay = container.querySelector('.baci-overlay') as HTMLElement;
  expect(overlay.style.backgroundColor).toBe(
    'var(--theme-hero-overlay, var(--theme-foreground))'
  );
  expect(overlay.style.opacity).toBe(gradient ? '0.6' : '0.4');
  expect(
    (container.querySelector('.baci-hero-content') as HTMLElement).style.color
  ).toBe('var(--theme-hero-foreground, var(--theme-background))');
});
