import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mockJsonLd = vi.hoisted(() => vi.fn());
vi.mock('@/components/seo/json-ld', () => ({
  JsonLd: ({ data }: { data: unknown }) => {
    mockJsonLd(data);
    return <script data-testid="webpage-jsonld" type="application/ld+json" />;
  },
}));

vi.mock('./ogabassey-home-style-loader', () => ({
  OgabasseyHomeStyleLoader: () => <style data-testid="home-style-loader" />,
}));

import { OgabasseyHomeStaticShellHead } from './ogabassey-home-static-shell-head';

describe('OgabasseyHomeStaticShellHead', () => {
  it('renders the static homepage WebPage JSON-LD and deferred style loader', () => {
    render(<OgabasseyHomeStaticShellHead />);

    expect(screen.getByTestId('webpage-jsonld')).toBeInTheDocument();
    expect(screen.getByTestId('home-style-loader')).toBeInTheDocument();
    expect(mockJsonLd).toHaveBeenCalledWith(
      expect.objectContaining({
        '@context': 'https://schema.org',
        '@type': 'WebPage',
      })
    );
  });
});
