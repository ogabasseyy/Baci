import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GoogleAdsConnectButton } from './google-ads-connect-button';
import { GOOGLE_ADS_CONNECT_PATH } from './google-ads-connect-path';

describe('GoogleAdsConnectButton', () => {
  it('links merchants to the server-owned OAuth start route', () => {
    render(
      <GoogleAdsConnectButton merchantId="550e8400-e29b-41d4-a716-446655440000" />
    );

    expect(
      screen.getByRole('link', { name: /connect google ads/i })
    ).toHaveAttribute(
      'href',
      `${GOOGLE_ADS_CONNECT_PATH}?merchantId=550e8400-e29b-41d4-a716-446655440000`
    );
  });
});
