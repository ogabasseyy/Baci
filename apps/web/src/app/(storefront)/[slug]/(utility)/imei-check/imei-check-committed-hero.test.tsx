import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ImeiCheckCommittedHero } from './imei-check-committed-hero';

describe('ImeiCheckCommittedHero', () => {
  it('paints branded IMEI copy for the monitored tenant without a merchant lookup', async () => {
    render(
      await ImeiCheckCommittedHero({
        params: Promise.resolve({ slug: 'ogabassey' }),
      })
    );

    expect(
      screen.getByRole('heading', { name: /Don't Get Scammed/i })
    ).toBeInTheDocument();
    expect(screen.getByText('Trusted by 10,000+ Buyers')).toBeInTheDocument();
  });

  it('omits branded IMEI copy for other merchants', async () => {
    const { container } = render(
      await ImeiCheckCommittedHero({
        params: Promise.resolve({ slug: 'other-store' }),
      })
    );

    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByRole('heading', { name: /Don't Get Scammed/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('Trusted by 10,000+ Buyers')
    ).not.toBeInTheDocument();
  });
});
