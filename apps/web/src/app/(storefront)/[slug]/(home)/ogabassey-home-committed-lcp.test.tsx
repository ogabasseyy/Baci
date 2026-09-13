import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OGABASSEY_DESCRIPTION, OGABASSEY_TITLE } from '@/config/ogabassey';
import { OgabasseyHomeCommittedLcp } from './ogabassey-home-committed-lcp';

describe('OgabasseyHomeCommittedLcp', () => {
  it('provides document semantics without a second visible banner', async () => {
    render(
      await OgabasseyHomeCommittedLcp({
        params: Promise.resolve({ slug: 'ogabassey.com' }),
      })
    );

    expect(screen.queryByText(OGABASSEY_DESCRIPTION)).not.toBeInTheDocument();
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(
      screen.getByRole('heading', { level: 1, name: OGABASSEY_TITLE })
    ).toHaveClass('sr-only');
    for (const role of ['img', 'link', 'button', 'region']) {
      expect(screen.queryByRole(role)).not.toBeInTheDocument();
    }
  });

  it('renders nothing for other storefronts', async () => {
    const ui = await OgabasseyHomeCommittedLcp({
      params: Promise.resolve({ slug: 'another-shop' }),
    });

    expect(ui).toBeNull();
  });
});
