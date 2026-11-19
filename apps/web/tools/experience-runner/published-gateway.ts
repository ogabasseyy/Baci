import { createServer } from 'node:http';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { digestBytes } from '../../src/lib/experience/manifest-digest';
import type { Resource } from '../../src/lib/experience/private-prerender-document';
import type { createPublicOutputReader } from '../../src/lib/experience/public-output-reader';
import { normalizeExperiencePath } from '../../src/lib/experience/route-ownership';
import { rewriteCssAssetUrls } from './rewrite-css-asset-urls';
export async function startPublishedGateway(
  reader: ReturnType<typeof createPublicOutputReader>,
  hostOrigin: string,
  port = 0,
  prerender?: {
    render(input: {
      slug: string;
      merchantId: string;
      buildDigest: string;
      path: string;
      resources: Resource[];
    }): Promise<string>;
  }
) {
  const host = new URL(hostOrigin);
  if (host.origin !== hostOrigin) throw Error('INVALID_HOST_ORIGIN');
  let executionOrigin = `http://127.0.0.1:${port}`;
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Robots-Tag', 'noindex,nofollow');
    res.setHeader(
      'Permissions-Policy',
      'camera=(),microphone=(),geolocation=(),payment=()'
    );
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'none';script-src 'self';style-src 'self' 'unsafe-inline';img-src 'self';font-src 'self';connect-src 'none';form-action 'none';base-uri 'none';frame-ancestors ${hostOrigin}`
    );
    try {
      if (req.method !== 'GET' || !req.url) throw Error('NOT_FOUND');
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname.includes('%') || (!prerender && url.search))
        throw Error('NOT_FOUND');
      if (
        [...url.searchParams.keys()].some((k) => k !== 'path') ||
        url.searchParams.getAll('path').length > 1
      )
        throw Error('NOT_FOUND');
      const match = url.pathname.match(
        /^\/published\/([a-z0-9-]+)\/([a-f0-9]{64})\/(index\.html|app\.(?:js|css)|assets\/[a-z0-9-]{1,80})$/
      );
      if (!match) throw Error('NOT_FOUND');
      const [, slug, build, path] = match;
      const head = await reader.manifest(slug);
      if (head?.buildDigest !== build || head.hostOrigin !== hostOrigin)
        throw Error('NOT_FOUND');
      const delivery = async (filePath: string) => {
        const f = await reader.read(slug, build, filePath);
        if (!f) throw Error('NOT_FOUND');
        let bytes = Buffer.from(f.bytes);
        if (filePath === 'app.css') {
          bytes = Buffer.from(
            rewriteCssAssetUrls(
              bytes.toString('utf8'),
              `/published/${slug}/${build}`,
              (head.assets ?? []).map((asset) => asset.assetId)
            )
          );
        }
        return { ...f, bytes, digest: digestBytes(bytes) };
      };
      if (path === 'index.html') {
        const [js, css, assets] = await Promise.all([
          delivery('app.js'),
          delivery('app.css'),
          prerender
            ? Promise.all(
                (head.assets ?? []).map((asset) =>
                  delivery(`assets/${asset.assetId}`)
                )
              )
            : Promise.resolve([]),
        ]);
        if (prerender) {
          const route = normalizeExperiencePath(
            url.searchParams.get('path') ?? '/'
          );
          const base = `${executionOrigin}/published/${slug}/${build}/`;
          const resources: Resource[] = [
            { path: 'app.js', url: `${base}app.js`, digest: js.digest },
            { path: 'app.css', url: `${base}app.css`, digest: css.digest },
          ];
          for (const file of assets) {
            resources.push({
              path: file.path,
              url: base + file.path,
              digest: file.digest,
            });
          }
          const html = await prerender.render({
            slug,
            merchantId: head.merchantId,
            buildDigest: build,
            path: route,
            resources,
          });
          if (
            JSON.stringify(await reader.manifest(slug)) !== JSON.stringify(head)
          )
            throw Error('NOT_FOUND');
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(html);
          return;
        }

        const integrity = (digest: string) =>
          `sha256-${Buffer.from(digest, 'hex').toString('base64')}`;
        const html =
          '<!doctype html>' +
          renderToStaticMarkup(
            createElement(
              'html',
              { 'data-baci-experience-build': build },
              createElement(
                'head',
                null,
                createElement('meta', {
                  name: 'viewport',
                  content: 'width=device-width,initial-scale=1',
                }),
                createElement('link', {
                  rel: 'stylesheet',
                  href: 'app.css',
                  integrity: integrity(css.digest),
                  crossOrigin: 'anonymous',
                })
              ),
              createElement(
                'body',
                null,
                createElement('div', { id: 'root' }),
                createElement('script', {
                  type: 'module',
                  src: 'app.js',
                  integrity: integrity(js.digest),
                  crossOrigin: 'anonymous',
                })
              )
            )
          );
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(html);
        return;
      }
      if (url.search) throw Error('NOT_FOUND');
      const file = await delivery(path);
      res.setHeader('Content-Type', file.mime);
      res.setHeader('X-Baci-Output-Digest', file.digest);
      res.end(file.bytes);
    } catch {
      res.statusCode = 404;
      res.end('Unavailable');
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address !== 'string')
        executionOrigin = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('NO_LISTENER');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
