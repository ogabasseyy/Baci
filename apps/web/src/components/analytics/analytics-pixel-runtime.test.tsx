import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AnalyticsPixelRuntime } from './analytics-pixel-runtime';

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

describe('AnalyticsPixelRuntime', () => {
  it('renders only configured pixel components', () => {
    render(
      <AnalyticsPixelRuntime
        fbPixelId="fb-1"
        gaId="G-STORE"
        snapchatPixelId={null}
        tiktokPixelId="tt-1"
        twitterPixelId={null}
      />
    );

    expect(screen.getByText('G-STORE')).toBeInTheDocument();
    expect(screen.getByText('fb-1')).toBeInTheDocument();
    expect(screen.getByText('tt-1')).toBeInTheDocument();
    expect(screen.queryByTestId('snapchat-pixel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('twitter-pixel')).not.toBeInTheDocument();
  });
});
