import { createHash } from 'node:crypto';
import type { PublicBootstrap } from '@baci/shared/experience';
/** Prototype document only, served on an isolated origin, never inserted in Next. */
export function prerenderDocument(
  html: string,
  bootstrap: PublicBootstrap,
  js: string,
  css: string
) {
  if (
    Buffer.byteLength(html) > 2097152 ||
    Buffer.byteLength(JSON.stringify(bootstrap)) > 1048576
  )
    throw Error('Prerender document budget');
  const safeJson = JSON.stringify({
    format: 'baci-prerender/v1',
    publicData: bootstrap,
  })
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const integrity = (value: string) =>
    `sha256-${createHash('sha256').update(value).digest('base64')}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Orbit local prerender experiment</title><link rel="stylesheet" href="/app.css" integrity="${integrity(css)}" crossorigin="anonymous"></head><body><div id="root">${html}</div><script id="baci-prerender-bootstrap" type="application/json">${safeJson}</script><script type="module" src="/app.js" integrity="${integrity(js)}" crossorigin="anonymous"></script></body></html>`;
}
