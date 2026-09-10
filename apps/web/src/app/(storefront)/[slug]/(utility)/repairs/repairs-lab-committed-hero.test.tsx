import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RepairsLabCommittedHero } from './repairs-lab-committed-hero';

describe('RepairsLabCommittedHero', () => {
  it('paints branded lab copy for the monitored tenant without a merchant lookup', async () => {
    render(
      await RepairsLabCommittedHero({
        params: Promise.resolve({ slug: 'ogabassey' }),
      })
    );

    expect(
      screen.getByRole('heading', { name: 'Repair Lab' })
    ).toBeInTheDocument();
    expect(screen.getByText(/Don't Ditch It/i)).toBeInTheDocument();
  });

  it('omits branded lab copy for other merchants', async () => {
    const { container } = render(
      await RepairsLabCommittedHero({
        params: Promise.resolve({ slug: 'other-store' }),
      })
    );

    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByRole('heading', { name: 'Repair Lab' })
    ).not.toBeInTheDocument();
  });
});
