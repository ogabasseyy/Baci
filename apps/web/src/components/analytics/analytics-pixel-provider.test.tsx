import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AnalyticsPixelProvider } from './analytics-pixel-provider';

vi.mock('./google-analytics', () => ({
  GoogleAnalytics: ({ measurementId }: { measurementId: string }) => (
    <div data-testid="google-analytics">{measurementId}</div>
  ),
}));

vi.mock('./facebook-pixel', () => ({
  FacebookPixel: ({ pixelId }: { pixelId: string }) => (
    <div data-testid="facebook-pixel">{pixelId}</div>
  ),
}));

vi.mock('./tiktok-pixel', () => ({
  TikTokPixel: ({ pixelId }: { pixelId: string }) => (
    <div data-testid="tiktok-pixel">{pixelId}</div>
  ),
}));

vi.mock('./snapchat-pixel', () => ({
  SnapchatPixel: ({ pixelId }: { pixelId: string }) => (
    <div data-testid="snapchat-pixel">{pixelId}</div>
  ),
}));

vi.mock('./twitter-pixel', () => ({
  TwitterPixel: ({ pixelId }: { pixelId: string }) => (
    <div data-testid="twitter-pixel">{pixelId}</div>
  ),
}));

describe('AnalyticsPixelProvider', () => {
  it('leaves ChatGPT measurement to the persistent shell instead of mounting a second Pixel on the homepage', () => {
    const { container } = render(
      <AnalyticsPixelProvider merchant={{ chatgpt_pixel_id: 'pixel-shell' }} />
    );
    expect(container).toBeEmptyDOMElement();
  });
  it('renders merchant analytics pixels from an explicit merchant payload', () => {
    render(
      <AnalyticsPixelProvider
        merchant={{
          google_analytics_id: 'G-STORE',
          facebook_pixel_id: 'fb-1',
          tiktok_pixel_id: 'tt-1',
        }}
      />
    );

    expect(screen.getByText('G-STORE')).toBeInTheDocument();
    expect(screen.queryByText('fb-1')).not.toBeInTheDocument();
    expect(screen.queryByText('tt-1')).not.toBeInTheDocument();
    expect(screen.queryByText('snap-1')).not.toBeInTheDocument();
    expect(screen.queryByText('tw-1')).not.toBeInTheDocument();
  });

  it('leaves all advertising pixels to the persistent shell while rendering route-owned GA4', () => {
    render(
      <AnalyticsPixelProvider
        merchant={{
          google_analytics_id: 'G-STORE',
          facebook_pixel_id: 'fb-1',
          tiktok_pixel_id: 'tt-1',
          snapchat_pixel_id: 'snap-1',
          twitter_pixel_id: 'tw-1',
        }}
      />
    );

    expect(screen.getByText('G-STORE')).toBeInTheDocument();
    expect(screen.queryByText('fb-1')).not.toBeInTheDocument();
    expect(screen.queryByText('tt-1')).not.toBeInTheDocument();
    expect(screen.queryByText('snap-1')).not.toBeInTheDocument();
    expect(screen.queryByText('tw-1')).not.toBeInTheDocument();
  });

  it('renders nothing when analytics IDs are empty or whitespace-only', () => {
    const { container } = render(
      <AnalyticsPixelProvider
        merchant={{
          google_analytics_id: '   ',
          facebook_pixel_id: '',
          tiktok_pixel_id: null,
        }}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when no explicit merchant analytics settings exist', () => {
    const { container } = render(<AnalyticsPixelProvider merchant={null} />);

    expect(container).toBeEmptyDOMElement();
  });
});

it('does not remount any advertising pixel on a route even when every merchant setting is configured', () => {
  const view = render(
    <AnalyticsPixelProvider
      merchant={{
        chatgpt_pixel_id: 'chatgpt-one',
        facebook_pixel_id: 'facebook-one',
        tiktok_pixel_id: 'TIKTOKONE',
        snapchat_pixel_id: '11111111-1111-4111-8111-111111111111',
        twitter_pixel_id: 'abc',
        twitter_event_ids: { viewContent: 'tw-abc-view' },
      }}
    />
  );
  expect(view.container).toBeEmptyDOMElement();
});
