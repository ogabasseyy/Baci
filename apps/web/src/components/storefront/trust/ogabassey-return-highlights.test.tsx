import { OGABASSEY_QUALITY_CHECKS } from '@baci/shared';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { OgabasseyReturnHighlights } from './ogabassey-return-highlights';

it('renders each quality check and only links to published device coverage', () => {
  const profile = { socialLinks: {}, derivedLinks: {} };
  const { rerender } = render(
    <OgabasseyReturnHighlights trustProfile={profile} />
  );
  expect(screen.getAllByRole('listitem')).toHaveLength(
    OGABASSEY_QUALITY_CHECKS.length
  );
  expect(
    screen.queryByRole('link', { name: 'See device coverage' })
  ).toBeNull();
  rerender(
    <OgabasseyReturnHighlights
      trustProfile={{
        ...profile,
        warrantyPolicy: {
          summary: 'Warranty applies.',
          localRoute: '/warranty',
        },
      }}
    />
  );
  expect(
    screen.getByRole('link', { name: 'See device coverage' })
  ).toHaveAttribute('href', './warranty');
});
