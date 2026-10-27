import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { AdPlatformSetupGuide } from './ad-platform-setup-guide';

const reviewedAssetDigests: Record<string, string> = {
  '/guides/ad-platforms/meta-settings.jpg':
    '89bee9add5c8ed98f5633d71ee0cbf5c5ae14924019eaa87b907c4dd307564a9',
  '/guides/ad-platforms/tiktok-settings.jpg':
    '338d82598233cfb72cab349dea66c0487adc4d697050ef39430cb0df63b9dc3e',
  '/guides/ad-platforms/snapchat-pixel-settings.jpg':
    '320dd7a1b9fcb586e13b543434161c2fdb527d439d8989541c380f28f7b66c05',
  '/guides/ad-platforms/x-connection-settings.jpg':
    'ac0fbb87fb143d41e3c5dd1c6d403136bf5bb9a89241edb5d75a780f2b3491bb',
};

describe('AdPlatformSetupGuide', () => {
  it.each([
    [
      'facebook',
      'Meta setup guide',
      'Grant Analytics consent',
      'optional for browser-only tracking',
      'https://business.facebook.com/events_manager',
    ],
    [
      'tiktok',
      'TikTok setup guide',
      'Grant Marketing consent',
      'optional for browser-only tracking',
      'https://ads.tiktok.com/',
    ],
    [
      'snapchat',
      'Snapchat setup guide',
      'Grant Marketing consent',
      'optional for browser-only tracking',
      'https://ads.snapchat.com/',
    ],
    [
      'x',
      'X setup guide',
      'Grant Marketing consent',
      'optional for browser-only tracking',
      'https://ads.x.com/',
    ],
  ] as const)('shows safe setup guidance for %s', async (platform, title, consent, detail, consoleUrl) => {
    render(<AdPlatformSetupGuide platform={platform} />);

    expect(screen.getByText(title)).toBeInTheDocument();
    expect(
      screen.getByText(
        /Keep access tokens, keys, and OAuth credentials private/
      )
    ).toBeInTheDocument();
    expect(screen.getByText(new RegExp(consent))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(detail))).toBeInTheDocument();
    expect(
      screen.getByRole('link', {
        name: /Open .* Ads Manager|Open Meta Events Manager/,
      })
    ).toHaveAttribute('href', consoleUrl);
    const screenshotAlts: Record<typeof platform, string[]> = {
      facebook: [
        'Meta Pixel and Conversions API settings in Baci with identifiers masked',
      ],
      tiktok: [
        'TikTok Pixel and Access Token settings in Baci with identifiers masked',
      ],
      snapchat: [
        'Snapchat Pixel and optional Conversions API token fields in Baci; the Pixel ID is masked and the token field is empty',
      ],
      x: [
        'X screenshot of the optional Conversions API access token and OAuth fields in Baci; inputs are blank',
      ],
    };
    const screenshots = screen.queryAllByRole('img');
    expect(screenshots.map((image) => image.getAttribute('alt'))).toEqual(
      screenshotAlts[platform]
    );
    for (const screenshot of screenshots) {
      const src = screenshot.getAttribute('src');
      expect(src).toBeTruthy();
      expect(existsSync(`public${src}`)).toBe(true);
      expect(
        createHash('sha256')
          .update(readFileSync(`public${src}`))
          .digest('hex')
      ).toBe(reviewedAssetDigests[src ?? '']);
      const metadata = await sharp(`public${src}`).metadata();
      expect(metadata.width).toBe(Number(screenshot.getAttribute('width')));
      expect(metadata.height).toBe(Number(screenshot.getAttribute('height')));
    }
    if (platform === 'facebook') {
      expect(
        screen.getByText(
          /Meta Limited Data Use is a separate setting from storefront consent/
        )
      ).toBeInTheDocument();
    }
    if (platform === 'x') {
      expect(
        screen.getByText(
          /This screenshot shows the optional server credential fields/
        )
      ).toBeInTheDocument();
    }
    expect(screen.getByRole('list').querySelectorAll('li')).toHaveLength(4);
    expect(screen.getByText(/create.*Pixel.*or select/i)).toBeInTheDocument();
    const distinguishingSteps: Record<typeof platform, RegExp> = {
      facebook: /Pixel Settings → Generate Access Token/,
      tiktok: /Pixel Settings → Generate Access Token/,
      snapchat: /Pixel Settings under Conversions API/,
      x: /all four OAuth credentials/,
    };
    expect(screen.getByText(distinguishingSteps[platform])).toBeInTheDocument();
  });
});
