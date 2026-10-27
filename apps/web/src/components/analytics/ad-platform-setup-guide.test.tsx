import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AdPlatformSetupGuide } from './ad-platform-setup-guide';

describe('AdPlatformSetupGuide', () => {
  it.each([
    ['facebook', 'Meta setup guide'],
    ['tiktok', 'TikTok setup guide'],
    ['snapchat', 'Snapchat setup guide'],
    ['x', 'X setup guide'],
  ] as const)('shows safe setup guidance for %s', (platform, title) => {
    render(<AdPlatformSetupGuide platform={platform} />);

    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getByText(/Never share screenshots/)).toBeInTheDocument();
    expect(screen.getByRole('list').querySelectorAll('li')).toHaveLength(4);
  });
});
