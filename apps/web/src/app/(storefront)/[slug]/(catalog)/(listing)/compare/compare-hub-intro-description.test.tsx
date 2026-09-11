import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CompareHubIntroDescription } from './compare-hub-intro-description';

describe('CompareHubIntroDescription', () => {
  it('streams the merchant-specific compare intro copy', () => {
    render(<CompareHubIntroDescription merchantName="Ogabassey" />);

    expect(
      screen.getByText(/Browse Ogabassey product comparison pages by category/)
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-compare-hub-intro-resolved]')
    ).not.toBeNull();
  });

  it('keeps the resolved copy off the cached-data import graph', () => {
    const source = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        'compare-hub-intro-description.tsx'
      ),
      'utf8'
    );

    expect(source).not.toContain('cached-data');
    expect(source).not.toContain('getRequestScopedMerchant');
  });
});
