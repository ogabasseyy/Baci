import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GoogleAdsReportingUnavailable } from './google-ads-reporting-unavailable';

describe('GoogleAdsReportingUnavailable', () => {
  it('shows the provider error and invokes the retry action', () => {
    const onRetry = vi.fn();

    render(
      <GoogleAdsReportingUnavailable
        error="Google Ads reporting is temporarily unavailable."
        onRetry={onRetry}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Google Ads reporting is temporarily unavailable.'
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Retry Google Ads reporting' })
    );
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('uses a safe fallback and omits retry when no callback is available', () => {
    render(<GoogleAdsReportingUnavailable />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Google Ads reporting is temporarily unavailable.'
    );
    expect(
      screen.queryByRole('button', { name: 'Retry Google Ads reporting' })
    ).not.toBeInTheDocument();
  });
});
