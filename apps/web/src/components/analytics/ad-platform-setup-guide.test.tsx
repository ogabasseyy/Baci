import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AdPlatformSetupGuide } from './ad-platform-setup-guide';

describe('AdPlatformSetupGuide', () => {
  it.each([
    ['facebook', 'Meta setup guide', 'Grant Analytics consent', 'Test Events'],
    [
      'tiktok',
      'TikTok setup guide',
      'Grant Marketing consent',
      'Events API access token',
    ],
    [
      'snapchat',
      'Snapchat setup guide',
      'Grant Marketing consent',
      'Conversions API token',
    ],
    [
      'x',
      'X setup guide',
      'Grant Marketing consent',
      'one server credential method',
    ],
  ] as const)('shows safe setup guidance for %s', (platform, title, consent, detail) => {
    render(<AdPlatformSetupGuide platform={platform} />);

    expect(screen.getByText(title)).toBeInTheDocument();
    expect(
      screen.getByText(
        /Keep access tokens, keys, and OAuth credentials private/
      )
    ).toBeInTheDocument();
    expect(screen.getByText(new RegExp(consent))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(detail))).toBeInTheDocument();
    if (platform === 'facebook') {
      expect(
        screen.getByText(
          /Marketing preference controls Meta data processing options/
        )
      ).toBeInTheDocument();
    }
    expect(screen.getByRole('list').querySelectorAll('li')).toHaveLength(4);
  });
});
