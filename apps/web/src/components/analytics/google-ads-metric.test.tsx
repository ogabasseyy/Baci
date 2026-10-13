import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GoogleAdsMetric } from './google-ads-metric';

describe('GoogleAdsMetric', () => {
  it('renders the label, icon, and preformatted value', () => {
    render(
      <GoogleAdsMetric
        formattedValue="₦12,500.00"
        icon={<span aria-hidden="true">$</span>}
        label="Spend"
      />
    );

    expect(screen.getByText('Spend')).toBeInTheDocument();
    expect(screen.getByText('₦12,500.00')).toBeInTheDocument();
    expect(screen.getByText('$')).toBeInTheDocument();
  });
});
