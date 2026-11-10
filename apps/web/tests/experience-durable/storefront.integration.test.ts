import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { JSDOM } from 'jsdom';
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { durableStorefrontFixture } from './fixture';

it('delivers full custom Orbit after store restart through normal anonymous/RLS reads and rejects stale publication', async () => {
  const root = mkdtempSync(join(tmpdir(), 'baci-delivery-'));
  const setup = await durableStorefrontFixture(root);
  try {
    const { client, delivery, ids, binding, f, api } = setup;
    const preparedCount = setup.renderCount();
    expect(preparedCount).toBe(4);
    const visible = await client.rpc('experience_public_prerender_binding', {
      p_slug: 'qa1',
      p_build: binding.buildDigest,
    });
    expect(visible.error).toBeNull();
    expect(visible.data).toEqual(binding);
    const privateRows = await client
      .from('experience_artifacts')
      .select('manifest');
    expect(privateRows.error || privateRows.data?.length === 0).toBeTruthy();
    for (const path of [
      '/',
      '/collections/all',
      '/phones/synthetic-device',
      '/pages/story',
    ]) {
      const boundary = await delivery.runtime.resolveBoundary(
        { id: ids.merchant, slug: 'qa1' },
        path
      );
      expect(boundary).not.toBeNull();
      if (!boundary) throw Error('Missing boundary');
      const response = await fetch(boundary.launch.src);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const text = await response.text();
      const document = new JSDOM(text).window.document;
      expect(
        document.querySelector('#root')?.textContent?.length
      ).toBeGreaterThan(40);
      expect(text).toContain('baci-prerender-bootstrap');
      expect(text).toContain('sha256-');
      if (path === '/') {
        const files = [];
        const urls = [
          ...document.querySelectorAll('script[src],link[rel="stylesheet"]'),
        ].map((node) => node.getAttribute('src') ?? node.getAttribute('href'));
        urls.push(...Object.values(boundary.bootstrap.assets ?? {}));
        for (const url of new Set(urls)) {
          if (!url) continue;
          const resource = await fetch(url);
          expect(resource.status).toBe(200);
          files.push({
            url,
            mime: resource.headers.get('content-type'),
            bytes: Buffer.from(await resource.arrayBuffer()).toString('base64'),
          });
        }
        const scratch = new URL(
          '../../../../.superpowers/sdd/2026-10-25-experience-durable/',
          import.meta.url
        );
        mkdirSync(scratch, { recursive: true });
        writeFileSync(
          new URL('public-launch.json', scratch),
          JSON.stringify({
            launch: boundary.launch,
            html: text,
            files,
            sourceDigest: binding.sourceDigest,
            hostOrigin: 'http://127.0.0.1:43174',
          })
        );
      }
    }
    expect(setup.renderCount()).toBe(preparedCount);
    const owner = createClient(api.url, api.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        headers: {
          Authorization: `Bearer ${api.ownerToken(ids.owner, ids.session)}`,
        },
      },
    });
    expect(
      (
        await owner
          .from('products')
          .update({ price: 275 })
          .eq('id', '33333333-3333-4333-8333-333333333333')
      ).error
    ).toBeNull();
    const updated = await delivery.runtime.resolveBoundary(
      { id: ids.merchant, slug: 'qa1' },
      '/'
    );
    if (!updated) throw Error('Missing updated boundary');
    const html = await (await fetch(updated.launch.src)).text();
    expect(
      new JSDOM(html).window.document.querySelector('#root')?.textContent
    ).toContain('275');
    expect(
      (
        await fetch(
          `${delivery.gateway.origin}/published/qa1/${binding.buildDigest}/renderer.js`
        )
      ).status
    ).toBe(404);
    setup.withdrawOnRender();
    expect((await fetch(updated.launch.src)).status).toBe(404);
    expect(
      (
        await client.rpc('experience_public_prerender_binding', {
          p_slug: 'qa1',
          p_build: binding.buildDigest,
        })
      ).data
    ).toBeNull();
    expect(
      (await f.pool.query('SELECT count(*) FROM orders')).rows[0].count
    ).toBe('0');
  } finally {
    await setup.close();
    rmSync(root, { recursive: true, force: true });
  }
});

it('does not serve a prepared public fragment after normal-owner withdrawal', async () => {
  const root = mkdtempSync(join(tmpdir(), 'baci-prepared-withdraw-'));
  const setup = await durableStorefrontFixture(root);
  try {
    const { delivery, ids, api } = setup;
    // Only the local setup grants this column; the owner still passes existing RLS.
    await setup.f.pool.query(
      'GRANT UPDATE(is_published) ON merchants TO authenticated'
    );
    const data = await delivery.runtime.resolveBoundary(
      { id: ids.merchant, slug: 'qa1' },
      '/'
    );
    if (!data) throw Error('Missing prepared boundary');
    expect((await fetch(data.launch.src)).status).toBe(200);
    expect(setup.renderCount()).toBe(4);
    const owner = createClient(api.url, api.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        headers: {
          Authorization: `Bearer ${api.ownerToken(ids.owner, ids.session)}`,
        },
      },
    });
    expect(
      (
        await owner
          .from('merchants')
          .update({ is_published: false })
          .eq('id', ids.merchant)
      ).error
    ).toBeNull();
    expect((await fetch(data.launch.src)).status).toBe(404);
    expect(setup.renderCount()).toBe(4);
    expect(
      (await setup.f.pool.query('SELECT count(*) FROM orders')).rows[0].count
    ).toBe('0');
  } finally {
    await setup.close();
    rmSync(root, { recursive: true, force: true });
  }
});
