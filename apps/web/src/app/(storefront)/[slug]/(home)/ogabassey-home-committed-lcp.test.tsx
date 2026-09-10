import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  OGABASSEY_DESCRIPTION,
  OGABASSEY_HOME_LCP_SUPPORT,
} from '@/config/ogabassey';
import { OgabasseyHomeCommittedLcp } from './ogabassey-home-committed-lcp';

describe('OgabasseyHomeCommittedLcp', () => {
  it('paints brand text LCP for OgaBassey tenants', async () => {
    render(
      await OgabasseyHomeCommittedLcp({
        params: Promise.resolve({ slug: 'ogabassey.com' }),
      })
    );

    expect(
      document.querySelector('[data-ogabassey-committed-lcp-copy="true"]')
        ?.textContent
    ).toBe(OGABASSEY_HOME_LCP_SUPPORT);
    expect(
      document.querySelector('[data-ogabassey-home-lcp-shell="true"]')
        ?.textContent
    ).not.toContain(OGABASSEY_DESCRIPTION);
    expect(
      document.querySelector('.ogabassey-home-unique-copy')?.textContent
    ).toBe(OGABASSEY_DESCRIPTION);
    expect(document.querySelector('img, picture, a, button')).toBeNull();
  });

  it('renders nothing for other storefronts', async () => {
    const ui = await OgabasseyHomeCommittedLcp({
      params: Promise.resolve({ slug: 'another-shop' }),
    });

    expect(ui).toBeNull();
  });
});
