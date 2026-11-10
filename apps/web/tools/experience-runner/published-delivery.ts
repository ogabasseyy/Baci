import type { PublicBootstrap } from '@baci/shared/experience';
import { digestBytes } from '../../src/lib/experience/manifest-digest';
import {
  createPrivatePrerenderDocument,
  type Resource,
} from '../../src/lib/experience/private-prerender-document';
import { productionDeliveryOrigins } from '../../src/lib/experience/production-origins';
import type { createPublicOutputReader } from '../../src/lib/experience/public-output-reader';
import { normalizeExperiencePath } from '../../src/lib/experience/route-ownership';
import { rewriteCssAssetUrls } from './rewrite-css-asset-urls';

/** Public output projection under normal anonymous RLS. This does not publish or
 * change a merchant pointer. Rendering is explicitly injected and must execute in
 * the offline runner with fresh public bootstrap, never on the delivery process. */
export function createProductionPublishedDelivery(config: {
  executionOrigin: string;
  hostOrigin: string;
  reader: ReturnType<typeof createPublicOutputReader>;
  render(input: {
    slug: string;
    merchantId: string;
    buildDigest: string;
    path: string;
    resources: Resource[];
  }): Promise<{ markup: string; bootstrap: PublicBootstrap }>;
}) {
  const { executionOrigin } = productionDeliveryOrigins({
    executionOrigin: config.executionOrigin,
    hostOrigins: [config.hostOrigin],
  });
  const headers = {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex,nofollow',
    'Permissions-Policy': 'camera=(),microphone=(),geolocation=(),payment=()',
    'Content-Security-Policy': `default-src 'none';script-src 'self';style-src 'self' 'unsafe-inline';img-src 'self';font-src 'self';connect-src 'none';worker-src 'none';form-action 'none';base-uri 'none';frame-ancestors ${config.hostOrigin}`,
  };
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      if (
        request.method !== 'GET' ||
        url.origin !== executionOrigin ||
        url.hash ||
        url.pathname.includes('%')
      )
        throw Error('NOT_FOUND');
      const match = url.pathname.match(
        /^\/published\/([a-z0-9][a-z0-9-]{0,99})\/([a-f0-9]{64})\/(index\.html|app\.(?:js|css)|assets\/[a-z0-9-]{1,80})$/
      );
      if (
        !match ||
        [...url.searchParams.keys()].some((key) => key !== 'path') ||
        url.searchParams.getAll('path').length > 1
      )
        throw Error('NOT_FOUND');
      const [, slug, buildDigest, path] = match;
      if (path !== 'index.html' && url.search) throw Error('NOT_FOUND');
      const head = await config.reader.manifest(slug);
      if (
        !head ||
        head.buildDigest !== buildDigest ||
        head.hostOrigin !== config.hostOrigin
      )
        throw Error('NOT_FOUND');
      const read = async (filePath: string) => {
        const file = await config.reader.read(slug, buildDigest, filePath);
        if (!file) throw Error('NOT_FOUND');
        let bytes = Buffer.from(file.bytes);
        if (filePath === 'app.css') {
          bytes = Buffer.from(
            rewriteCssAssetUrls(
              bytes.toString('utf8'),
              `/published/${slug}/${buildDigest}`,
              (head.assets ?? []).map((asset) => asset.assetId)
            )
          );
        }
        return { ...file, bytes, digest: digestBytes(bytes) };
      };
      let response: Response;
      if (path === 'index.html') {
        const files = await Promise.all(
          [
            'app.js',
            'app.css',
            ...(head.assets ?? []).map((asset) => `assets/${asset.assetId}`),
          ].map(read)
        );
        const base = `${executionOrigin}/published/${slug}/${buildDigest}/`;
        const resources = files.map((file) => ({
          path: file.path,
          url: base + file.path,
          digest: file.digest,
        }));
        const rendered = await config.render({
          slug,
          merchantId: head.merchantId,
          buildDigest,
          path: normalizeExperiencePath(url.searchParams.get('path') ?? '/'),
          resources,
        });
        const html = createPrivatePrerenderDocument(
          rendered.markup,
          rendered.bootstrap,
          resources,
          { kind: 'published', buildDigest, executionOrigin }
        );
        response = new Response(html, {
          headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
        });
      } else {
        const file = await read(path);
        response = new Response(Uint8Array.from(file.bytes), {
          headers: {
            ...headers,
            'Content-Type': file.mime,
            'X-Baci-Output-Digest': file.digest,
          },
        });
      }
      // Recheck all output after awaits, including static bytes, not just documents.
      if (
        JSON.stringify(await config.reader.manifest(slug)) !==
        JSON.stringify(head)
      )
        throw Error('NOT_FOUND');
      return response;
    } catch {
      return new Response('Unavailable', { status: 404, headers });
    }
  };
}
