// @vitest-environment node
import { chromium } from '@playwright/test';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { PortableHomeView } from '../../src/components/storefront/portable/portable-home';
import { PublicationRevisionMarker } from '../../src/components/storefront/publication-revision-marker';
import { createPortablePublishedSnapshot } from '../../src/lib/portable-published-snapshot';
import { catalog, home, merchant } from '../builder-preview-spike/fixtures';
import { verifyPublication } from './verify-publication';

it('verifies actual rendered revision plus changed content without credentials; HTTP200 alone and mismatched content fail', async () => {
  const snapshot = await createPortablePublishedSnapshot(home);
  const version = `published:${merchant.id}`;
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>${renderToStaticMarkup(
    <PublicationRevisionMarker
      version={version}
      contentDigest={snapshot.publishedVersion}
    >
      <PortableHomeView config={home} merchant={merchant} catalog={catalog} />
    </PublicationRevisionMarker>
  )}</body></html>`;
  const fetchPublic = vi.fn(async (_url: string) => ({
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: Buffer.from(html),
  }));
  const launch = () => chromium.launch({ headless: true, channel: 'chrome' });
  const input = {
    merchantId: merchant.id,
    url: 'https://approval-fixture.usebaci.com',
    publishedVersion: version,
    contentDigest: snapshot.publishedVersion,
    config: home,
  };
  expect(await verifyPublication(input, { launch, fetchPublic })).toBe(true);
  const changed = structuredClone(home);
  const hero = changed.content.find((block) => block.type === 'Hero');
  if (hero?.type === 'Hero') hero.props.title = 'Different approved copy';
  expect(
    await verifyPublication(
      { ...input, config: changed },
      { launch, fetchPublic }
    )
  ).toBe(false);
  const simple = vi.fn(async (_url: string) => ({
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: Buffer.from('<p>OK</p>'),
  }));
  expect(await verifyPublication(input, { launch, fetchPublic: simple })).toBe(
    false
  );
  const telemetry = vi.fn(async (_url: string) => ({
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: Buffer.from(
      html.replace(
        '</head>',
        '<script src="https://www.googletagmanager.com/gtag/js?id=fixture"></script><script src="https://connect.facebook.net/en_US/fbevents.js"></script><script src="https://analytics.tiktok.com/i18n/pixel/events.js"></script><script src="https://sc-static.net/scevent.min.js"></script><script src="https://static.ads-twitter.com/uwt.js"></script><script src="/baci-relay/static/recorder.js"></script><script>fetch("/baci-relay/decide?v=3").catch(()=>{});</script></head>'
      )
    ),
  }));
  expect(
    await verifyPublication(input, { launch, fetchPublic: telemetry })
  ).toBe(true);
  expect(
    telemetry.mock.calls.every(
      ([url]) =>
        new URL(url).origin === input.url && !url.includes('/baci-relay')
    )
  ).toBe(true);
  const required = vi.fn(async (url: string) => {
    if (url.endsWith('/required.js'))
      throw Error('required resource unavailable');
    return {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: Buffer.from(
        html.replace('</head>', '<script src="/required.js"></script></head>')
      ),
    };
  });
  expect(
    await verifyPublication(input, { launch, fetchPublic: required })
  ).toBe(false);
  expect(fetchPublic.mock.calls.every((args) => args.length === 1)).toBe(true);
}, 60000);

it('waits for delayed below-fold lazy images before accepting delivery', async () => {
  const snapshot = await createPortablePublishedSnapshot(home);
  const version = `published:${merchant.id}`;
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64'
  );
  const html = renderToStaticMarkup(
    <PublicationRevisionMarker
      version={version}
      contentDigest={snapshot.publishedVersion}
    >
      <PortableHomeView config={home} merchant={merchant} catalog={catalog} />
      <div style={{ height: 10000 }} />
      <img
        loading="lazy"
        src="https://approval-fixture.usebaci.com/proof.png"
        alt="Proof fixture"
      />
    </PublicationRevisionMarker>
  );
  const fetchPublic = async (url: string) => {
    if (url.endsWith('/proof.png')) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return {
        status: 200,
        headers: { 'content-type': 'image/png' },
        body: png,
      };
    }
    return {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: Buffer.from(html),
    };
  };
  expect(
    await verifyPublication(
      {
        merchantId: merchant.id,
        url: 'https://approval-fixture.usebaci.com',
        publishedVersion: version,
        contentDigest: snapshot.publishedVersion,
        config: home,
      },
      {
        launch: () => chromium.launch({ headless: true, channel: 'chrome' }),
        fetchPublic,
      }
    )
  ).toBe(true);
}, 30000);

it('rejects missing visible action, navigation, footer and catalog copy despite a correct revision marker', async () => {
  const snapshot = await createPortablePublishedSnapshot(home);
  const version = `published:${merchant.id}`;
  for (const type of [
    'Header',
    'Hero',
    'Text',
    'Button',
    'Footer',
    'ProductGrid',
    'HeroPrefix',
    'TextPrefix',
    'FooterPrefix',
  ] as const) {
    const rendered = structuredClone(home);
    const block = rendered.content.find(
      (block) => block.type === type.replace('Prefix', '')
    );
    if (!block) throw Error('fixture');
    if (type === 'HeroPrefix' && block.type === 'Hero')
      block.props.subtitle += ' unavailable';
    else if (type === 'TextPrefix' && block.type === 'Text')
      block.props.content += ' unavailable';
    else if (type === 'FooterPrefix' && block.type === 'Footer')
      block.props.copyrightText += ' unavailable';
    else if (block.type === 'Header') block.props.navigationLinks = [];
    else if (block.type === 'Hero') block.props.ctaText = '';
    else if (block.type === 'Text') block.props.content = '';
    else if (block.type === 'Button') block.props.text = '';
    else if (block.type === 'Footer') block.props.quickLinks = [];
    else if (block.type === 'ProductGrid') block.props.title = '';
    const html = renderToStaticMarkup(
      <PublicationRevisionMarker
        version={version}
        contentDigest={snapshot.publishedVersion}
      >
        <PortableHomeView
          config={rendered}
          merchant={merchant}
          catalog={catalog}
        />
      </PublicationRevisionMarker>
    );
    expect(
      await verifyPublication(
        {
          merchantId: merchant.id,
          url: 'https://approval-fixture.usebaci.com',
          publishedVersion: version,
          contentDigest: snapshot.publishedVersion,
          config: home,
        },
        {
          launch: () => chromium.launch({ headless: true, channel: 'chrome' }),
          fetchPublic: async () => ({
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
            body: Buffer.from(html),
          }),
        }
      )
    ).toBe(false);
  }
}, 60000);
