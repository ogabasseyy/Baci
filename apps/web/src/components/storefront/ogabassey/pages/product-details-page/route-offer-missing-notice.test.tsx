import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RouteOfferMissingNotice } from './route-offer-missing-notice';

describe('RouteOfferMissingNotice', () => {
  it('announces the dead exact-offer link', () => {
    render(<RouteOfferMissingNotice />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      /no longer available/
    );
  });

  it('uses the dark-mode-remapped amber notice trio', () => {
    render(<RouteOfferMissingNotice />);

    // border-amber-200/bg-amber-50/text-amber-800 are all remapped by the
    // storefront dark-mode utilities layer; amber-300 borders escape it.
    expect(screen.getByRole('alert')).toHaveClass(
      'border-amber-200',
      'bg-amber-50',
      'text-amber-800'
    );
  });
});
