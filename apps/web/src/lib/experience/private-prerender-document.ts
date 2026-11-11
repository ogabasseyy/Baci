import type { PublicBootstrap } from '@baci/shared/experience';
import { JSDOM } from 'jsdom';
import { productionOrigin } from './production-origins';

export interface Resource {
  path: string;
  url: string;
  digest: string;
}
/** Parse/validate inert markup only. No merchant module executes in this process. */
export function createPrivatePrerenderDocument(
  markup: string,
  bootstrap: PublicBootstrap,
  resources: Resource[],
  options: {
    kind?: 'private' | 'published';
    buildDigest?: string;
    executionOrigin?: string;
  } = {}
) {
  if (
    Buffer.byteLength(markup) > 2097152 ||
    Buffer.byteLength(JSON.stringify(bootstrap)) > 1048576
  )
    throw Error('QUOTA_EXCEEDED');
  const fragment = JSDOM.fragment(markup);
  for (const element of fragment.querySelectorAll('*')) {
    const tag = element.localName.toLowerCase();
    if (
      [
        'script',
        'iframe',
        'frame',
        'frameset',
        'object',
        'embed',
        'base',
        'meta',
        'style',
        'noscript',
        'template',
      ].includes(tag)
    )
      throw Error('BUILD_FAILED');
    if (
      tag === 'link' &&
      !(
        element.getAttribute('rel') === 'preload' &&
        element.getAttribute('as') === 'image' &&
        trustedImagePreload(element, resources)
      )
    )
      throw Error('BUILD_FAILED');
    for (const attr of element.attributes) {
      const name = attr.name.toLowerCase();
      if (
        name.startsWith('on') ||
        name === 'srcdoc' ||
        (name === 'id' &&
          ['root', 'baci-prerender-bootstrap'].includes(attr.value))
      )
        throw Error('BUILD_FAILED');
      if (
        ['href', 'xlink:href', 'src', 'action', 'formaction'].includes(name) &&
        /^(javascript:|vbscript:|data:text\/html)/i.test(
          Array.from(attr.value)
            .filter((char) => char.charCodeAt(0) > 32)
            .join('')
        )
      )
        throw Error('BUILD_FAILED');
    }
  }
  const wrapper = fragment.ownerDocument.createElement('div');
  wrapper.append(fragment);
  const normalized = wrapper.innerHTML;
  const json = JSON.stringify({
    format: 'baci-prerender/v1',
    publicData: bootstrap,
  })
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const js = resources.find((r) => r.path === 'app.js');
  const css = resources.find((r) => r.path === 'app.css');
  if (!js) throw Error('BUILD_FAILED');
  for (const resource of resources) {
    const url = new URL(resource.url);
    if (
      (options.executionOrigin
        ? url.origin !== productionOrigin(options.executionOrigin)
        : url.protocol !== 'http:' || url.hostname !== '127.0.0.1') ||
      !(options.kind === 'published'
        ? /^\/published\/[a-z0-9][a-z0-9-]{0,99}\/[a-f0-9]{64}\/(app\.(js|css)|assets\/[a-z0-9-]{1,80})$/.test(
            url.pathname
          ) &&
          url.pathname ===
            new URL(js.url).pathname.replace(/app\.js$/, '') + resource.path
        : /^\/resource\/[a-f0-9]{64}\//.test(url.pathname)) ||
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      url.href !== resource.url ||
      url.origin !== new URL(js.url).origin ||
      !/^[a-f0-9]{64}$/.test(resource.digest)
    )
      throw Error('BUILD_FAILED');
  }
  if (options.buildDigest && !/^[a-f0-9]{64}$/.test(options.buildDigest))
    throw Error('BUILD_FAILED');
  const marker = options.buildDigest
    ? ` data-baci-experience-build="${options.buildDigest}"`
    : '';
  const integrity = (r: Resource) =>
    `sha256-${Buffer.from(r.digest, 'hex').toString('base64')}`;
  return `<!doctype html><html lang="en" data-baci-hydration="pending"${marker}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">${css ? `<link rel="stylesheet" href="${css.url}" integrity="${integrity(css)}" crossorigin="anonymous">` : ''}</head><body><div id="root" inert>${normalized}</div><script id="baci-prerender-bootstrap" type="application/json">${json}</script><script type="module" src="${js.url}" integrity="${integrity(js)}" crossorigin="anonymous"></script></body></html>`;
}

/** Responsive SSR preloads may omit href; every fetch candidate stays asset-bound. */
function trustedImagePreload(element: Element, resources: Resource[]): boolean {
  const trusted = (url: string) =>
    resources.some((r) => r.path.startsWith('assets/') && r.url === url);
  const href = element.getAttribute('href');
  const srcset = element.getAttribute('imagesrcset');
  if (href !== null && !trusted(href)) return false;
  if (srcset === null) return href !== null && trusted(href);
  return srcset.split(',').every((candidate) => {
    const parts = candidate.trim().split(/\s+/);
    return (
      parts.length >= 1 &&
      parts.length <= 2 &&
      trusted(parts[0]) &&
      (parts.length === 1 ||
        (/^(?:[1-9]\d*w|(?:\d+(?:\.\d+)?|\.\d+)x)$/.test(parts[1]) &&
          Number.parseFloat(parts[1]) > 0))
    );
  });
}
