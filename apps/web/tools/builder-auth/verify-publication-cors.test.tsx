// @vitest-environment node
import { chromium } from '@playwright/test';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { PortableHomeView } from '../../src/components/storefront/portable/portable-home';
import { PublicationRevisionMarker } from '../../src/components/storefront/publication-revision-marker';
import { createPortablePublishedSnapshot } from '../../src/lib/portable-published-snapshot';
import { catalog, home, merchant } from '../builder-preview-spike/fixtures';
import { verifyPublication } from './verify-publication';

it('proves a real browser cross-origin public RPC with API-key headers and bounded CORS', async () => {
  const snapshot = await createPortablePublishedSnapshot(home);
  const version = `published:${merchant.id}`;
  const markup = renderToStaticMarkup(
    <PublicationRevisionMarker
      version={version}
      contentDigest={snapshot.publishedVersion}
    >
      <PortableHomeView
        config={home}
        merchant={merchant}
        catalog={catalog}
        inert={false}
      />
    </PublicationRevisionMarker>
  );
  const rpc = `https://fixture.supabase.co/rest/v1/rpc/builder_public_home?p_merchant=${merchant.id}`;
  const html = `<!doctype html><html><body><main style="visibility:hidden">${markup}</main><script type="module">const response=await fetch(${JSON.stringify(rpc)},{headers:{apikey:'fixture-public',authorization:'Bearer fixture-public'},mode:'cors'});const result=await response.json();if(result.ready)document.querySelector('main').style.visibility='visible';</script></body></html>`;
  const fetchPublic = vi.fn(async (url: string) => ({
    status: 200,
    headers: {
      'content-type':
        url === rpc ? 'application/json' : 'text/html; charset=utf-8',
    },
    body: Buffer.from(url === rpc ? '\u007b"ready":true\u007d' : html),
  }));
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
        launch: () => chromium.launch({ channel: 'chrome', headless: true }),
        publicDatabase: {
          origin: 'https://fixture.supabase.co',
          publishableKey: 'fixture-public',
        },
        fetchPublic,
      }
    )
  ).toBe(true);
  expect(fetchPublic).toHaveBeenCalledWith(rpc);
  expect(fetchPublic.mock.calls.every((args) => args.length === 1)).toBe(true);
}, 30000);
