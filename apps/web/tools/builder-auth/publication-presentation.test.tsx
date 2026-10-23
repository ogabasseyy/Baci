// @vitest-environment node
import { chromium } from '@playwright/test';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { PortableHomeView } from '../../src/components/storefront/portable/portable-home';
import { PublicationRevisionMarker } from '../../src/components/storefront/publication-revision-marker';
import { createPortablePublishedSnapshot } from '../../src/lib/portable-published-snapshot';
import { portableHomeSchema } from '../../src/schemas/portable-storefront';
import { catalog, home, merchant } from '../builder-preview-spike/fixtures';
import { verifyPublicationPresentation } from './publication-presentation';
import { verifyPublication } from './verify-publication';

it('rejects ignored presentation-only edits despite exact text, links and revision markers', async () => {
  for (const change of [
    'theme',
    'hero-align',
    'hero-padding',
    'hero-overlay',
    'text-align',
    'button-variant',
    'button-size',
    'grid-columns',
    'header-logo',
  ]) {
    const approved = portableHomeSchema.parse(home);
    const hero = approved.content.find((b) => b.type === 'Hero');
    if (hero?.type !== 'Hero') throw Error('fixture');
    if (change === 'hero-overlay') {
      hero.props.backgroundImage =
        'https://approval-fixture.usebaci.com/proof.png';
      hero.props.overlay = true;
    }
    const rendered = structuredClone(approved);
    if (change === 'theme') rendered.theme = { colors: { primary: '#123456' } };
    for (const b of rendered.content) {
      if (b.type === 'Hero' && change === 'hero-align') b.props.align = 'right';
      if (b.type === 'Hero' && change === 'hero-padding')
        b.props.padding = 'large';
      if (b.type === 'Hero' && change === 'hero-overlay')
        b.props.overlay = false;
      if (b.type === 'Text' && change === 'text-align') b.props.align = 'right';
      if (b.type === 'Button' && change === 'button-variant')
        b.props.variant = 'accent';
      if (b.type === 'Button' && change === 'button-size') b.props.size = 'lg';
      if (b.type === 'ProductGrid' && change === 'grid-columns')
        b.props.columns = 4;
      if (b.type === 'Header' && change === 'header-logo')
        b.props.showLogo = false;
    }
    const digest = await createPortablePublishedSnapshot(approved);
    const version = `published:${merchant.id}`;
    const html = renderToStaticMarkup(
      <PublicationRevisionMarker
        version={version}
        contentDigest={digest.publishedVersion}
      >
        <PortableHomeView
          config={rendered}
          merchant={merchant}
          catalog={catalog}
          inert={false}
        />
      </PublicationRevisionMarker>
    );
    expect(
      await verifyPublication(
        {
          merchantId: merchant.id,
          url: 'https://approval-fixture.usebaci.com',
          publishedVersion: version,
          contentDigest: digest.publishedVersion,
          config: approved,
        },
        {
          launch: () => chromium.launch({ headless: true, channel: 'chrome' }),
          fetchPublic: async (url) =>
            url.endsWith('.png')
              ? {
                  status: 200,
                  headers: { 'content-type': 'image/png' },
                  body: Buffer.from(
                    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
                    'base64'
                  ),
                }
              : {
                  status: 200,
                  headers: { 'content-type': 'text/html; charset=utf-8' },
                  body: Buffer.from(html),
                },
        }
      ),
      change
    ).toBe(false);
  }
}, 60000);

it('accepts correctly applied non-default presentation', async () => {
  const config = portableHomeSchema.parse(home);
  config.theme = {
    colors: {
      primary: '#123456',
      background: '#111111',
      foreground: '#ffffff',
    },
  };
  for (const b of config.content) {
    if (b.type === 'Hero') {
      b.props.align = 'right';
      b.props.padding = 'large';
    }
    if (b.type === 'Button') {
      b.props.variant = 'accent';
      b.props.size = 'lg';
      b.props.align = 'right';
    }
    if (b.type === 'Text') b.props.align = 'center';
    if (b.type === 'ProductGrid') b.props.columns = 4;
    if (b.type === 'Header') b.props.showLogo = false;
  }
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage();
    await page.setContent(
      renderToStaticMarkup(
        <main>
          <PortableHomeView
            config={config}
            merchant={merchant}
            catalog={catalog}
            inert={false}
          />
        </main>
      )
    );
    expect(
      await verifyPublicationPresentation(
        page.locator('main'),
        config,
        merchant.id
      )
    ).toBe(true);
  } finally {
    await browser.close();
  }
}, 30000);
