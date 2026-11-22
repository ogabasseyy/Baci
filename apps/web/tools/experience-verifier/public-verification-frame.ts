import { JSDOM } from 'jsdom';
import { productionDeliveryOrigins } from '@/lib/experience/production-origins';
import { normalizeExperiencePath } from '@/lib/experience/route-ownership';
import { publicFrameBinding } from '@/schemas/experience-public-output-binding';
import {
  deliveryDocumentSandbox,
  publishedDeliveryPolicy,
} from '../experience-runner/delivery-document-policy';
import { createBoundPublicFetcher } from './public-fetch';

/** Fetch route-bound frame documents as inert data; the browser must still render them. */
export async function fetchPublicFrames(
  input: unknown,
  executionOrigin: string,
  routes: { path: string }[],
  options: Pick<
    Parameters<typeof createBoundPublicFetcher>[0],
    'resolve' | 'network' | 'signal'
  > = {}
) {
  const binding = publicFrameBinding.parse(input);
  const origins = productionDeliveryOrigins({
    executionOrigin,
    hostOrigins: [binding.canonicalBase],
  });
  if (!routes.length || routes.length > 128)
    throw Error('INVALID_PUBLIC_ROUTES');
  const root = `${origins.executionOrigin}/published/${binding.slug}/${binding.buildDigest}`;
  const seen = new Set<string>();
  const urls = routes.map(({ path }) => {
    if (normalizeExperiencePath(path) !== path || seen.has(path))
      throw Error('INVALID_PUBLIC_ROUTES');
    seen.add(path);
    return `${root}/index.html?path=${encodeURIComponent(path)}`;
  });
  const fetchBound = createBoundPublicFetcher({
    origins: [origins.executionOrigin],
    urls,
    ...options,
  });
  const integrity = (value: string) =>
    `sha256-${Buffer.from(value, 'hex').toString('base64')}`;
  const policy = `${publishedDeliveryPolicy(origins.hostOrigins[0])}; ${deliveryDocumentSandbox}`;
  const frames = [];
  for (const url of urls) {
    const response = await fetchBound(url);
    if (
      response.contentType.split(';', 1)[0].trim().toLowerCase() !==
        'text/html' ||
      response.securityHeaders['content-security-policy'] !== policy
    )
      throw Error('PUBLIC_FRAME_MISMATCH');
    const html = new TextDecoder('utf-8', { fatal: true }).decode(
      response.body
    );
    if ((html.match(/</g) ?? []).length > 20000)
      throw Error('PUBLIC_FRAME_MISMATCH');
    const dom = new JSDOM(html);
    try {
      const doc = dom.window.document;
      const scripts = doc.querySelectorAll('script');
      const styles = doc.querySelectorAll('link[rel="stylesheet"]');
      const rootElements = doc.querySelectorAll('#root');
      const bootstrap = doc.querySelectorAll('#baci-prerender-bootstrap');
      const module = [...scripts].find(
        (element) => element.getAttribute('src') === `${root}/app.js`
      );
      if (
        doc.documentElement.getAttribute('data-baci-experience-build') !==
          binding.buildDigest ||
        rootElements.length !== 1 ||
        !rootElements[0].hasAttribute('inert') ||
        bootstrap.length !== 1 ||
        bootstrap[0].tagName !== 'SCRIPT' ||
        bootstrap[0].getAttribute('type') !== 'application/json' ||
        scripts.length !== 2 ||
        !module ||
        module.getAttribute('type') !== 'module' ||
        module.getAttribute('integrity') !== integrity(binding.scriptDigest) ||
        module.getAttribute('crossorigin') !== 'anonymous' ||
        styles.length !== 1 ||
        styles[0].getAttribute('href') !== `${root}/app.css` ||
        styles[0].getAttribute('integrity') !==
          integrity(binding.styleDigest) ||
        styles[0].getAttribute('crossorigin') !== 'anonymous'
      )
        throw Error('PUBLIC_FRAME_MISMATCH');
      frames.push({
        url,
        mime: 'text/html',
        bytes: response.body,
        headers: response.securityHeaders,
      });
    } finally {
      dom.window.close();
    }
  }
  return frames;
}
