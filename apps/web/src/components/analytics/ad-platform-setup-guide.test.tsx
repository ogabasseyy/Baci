import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { AdPlatformSetupGuide } from './ad-platform-setup-guide';

// Digests detect changed binaries; they do not validate that a mask is present.
const pinnedAssetDigests: Record<string, string> = {
  '/guides/ad-platforms/meta-settings.jpg':
    '89bee9add5c8ed98f5633d71ee0cbf5c5ae14924019eaa87b907c4dd307564a9',
  '/guides/ad-platforms/tiktok-settings.jpg':
    'e0b6ee0304bb81ae0f5af57fff87cc03ab4199b4d5d806d939e7350a3bd98c63',
  '/guides/ad-platforms/snapchat-pixel-settings.jpg':
    '320dd7a1b9fcb586e13b543434161c2fdb527d439d8989541c380f28f7b66c05',
  '/guides/ad-platforms/x-connection-settings.jpg':
    '813b756510b5bcb0413d72dde361c5eef07bec6f4c73fe257eaf74d7a15fe4be',
};
const webRoot = resolve(__dirname, '../../../');
const checklistPath = resolve(
  webRoot,
  '../../docs/guides/ad-tracking-screenshot-review.md'
);

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
        'TikTok Pixel and Access Token settings in Baci; the Pixel ID is masked and the token value is not shown',
      ],
      snapchat: [
        'Snapchat Pixel and optional Conversions API token fields in Baci; the Pixel ID is masked and the token field is empty',
      ],
      x: [
        'X screenshot of the optional server credential fields in Baci; all input values are blank',
      ],
    };
    const screenshots = screen.queryAllByRole('img');
    expect(screenshots.map((image) => image.getAttribute('alt'))).toEqual(
      screenshotAlts[platform]
    );
    for (const screenshot of screenshots) {
      const src = screenshot.getAttribute('src');
      expect(src).toBeTruthy();
      const assetPath = resolve(webRoot, 'public', src?.slice(1) ?? '');
      expect(existsSync(assetPath)).toBe(true);
      expect(
        createHash('sha256').update(readFileSync(assetPath)).digest('hex')
      ).toBe(pinnedAssetDigests[src ?? '']);
      const metadata = await sharp(assetPath).metadata();
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
          /This cropped screenshot starts at the optional server credential fields/
        )
      ).toBeInTheDocument();
    }
    expect(screen.getByRole('list').querySelectorAll('li')).toHaveLength(4);
    expect(screen.getByText(/create.*Pixel.*or select/i)).toBeInTheDocument();
    const distinguishingSteps: Record<typeof platform, RegExp> = {
      facebook: /Pixel Settings → Generate Access Token/,
      tiktok: /Tools → Events → Connect data source → Web/,
      snapchat: /Pixel Settings under Conversions API/,
      x: /all four OAuth credentials/,
    };
    expect(screen.getByText(distinguishingSteps[platform])).toBeInTheDocument();
  });

  it('keeps the human screenshot review checklist available beside digest pins', () => {
    expect(existsSync(checklistPath)).toBe(true);
    const checklist = readFileSync(checklistPath, 'utf8');
    expect(checklist).toMatch(
      /do not determine whether an\s+image is private/i
    );
    for (const imagePath of Object.keys(pinnedAssetDigests)) {
      expect(checklist).toContain(imagePath.split('/').at(-1));
    }
  });
});
