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
});
