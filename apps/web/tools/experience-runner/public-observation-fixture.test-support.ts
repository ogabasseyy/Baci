import { createHash } from 'node:crypto';

export const origin = 'https://shop.example.com';
const execution = 'https://runtime.example.net';
const build = 'a'.repeat(64);
export const merchantId = '11111111-1111-4111-8111-111111111111';
export const productId = '33333333-3333-4333-8333-333333333333';
export const cartId = '44444444-4444-4444-8444-444444444444';
export const syntheticCart = {
  cartId,
  merchantId,
  version: 1,
  lines: [{ item: { productId }, quantity: 1 }],
};
export const syntheticCheckout = {
  cartId,
  merchantId,
  cartVersion: 1,
  checkoutSessionId: '55555555-5555-4555-8555-555555555555',
  lines: [{ productId, variantId: null, quantity: 1, available: true }],
};
const base = `${execution}/published/synthetic/${build}`;
const js = `document.documentElement.dataset.baciHydration='ready'; document.querySelector('#add').onclick=()=>parent.postMessage('add','*'); document.querySelector('#review').onclick=()=>parent.postMessage('review','*');`;
const css = 'body { color: black }';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const resource = (
  url: string,
  mime: string,
  bytes: string,
  headers: Record<string, string> = {}
) => ({ url, mime, bytes: Buffer.from(bytes).toString('base64'), headers });

export function fixture(
  options: { tryOrder?: boolean; dynamicChunk?: boolean } = {}
) {
  const paths = ['/', '/products/device'];
  const parent = (
    path: string
  ) => `<title>Store ${path}</title><link rel="canonical" href="${origin}${path}"><iframe data-baci-experience-build="${build}" sandbox="allow-scripts" src="${base}/index.html?path=${encodeURIComponent(path)}"></iframe><script>
    ${options.dynamicChunk ? "window.dynamicReady = new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = '/_next/static/chunks/lazy.js'; script.onload = resolve; script.onerror = reject; document.head.append(script); });" : ''}
    addEventListener('message', async (event) => {
      ${options.dynamicChunk ? 'await window.dynamicReady; if (window.syntheticChunk !== 42) return;' : ''}
      if (event.data === 'add') { await fetch('/api/storefront/cart/commands',{method:'POST',body:JSON.stringify({operationId:'add',expectedVersion:1,command:{type:'add',item:{productId:'${productId}'},quantity:1}})}); await fetch('/api/storefront/cart'); }
      if (event.data === 'review') { ${options.tryOrder ? "await fetch('/api/orders',{method:'POST',body:'{}'}).catch(()=>{});" : ''} await fetch('/api/storefront/cart/checkout',{method:'POST',body:JSON.stringify({operationId:'review',expectedVersion:1,cartId:'${cartId}'})}); document.body.insertAdjacentHTML('beforeend','<div role="dialog" aria-label="Continue to checkout"><button>Continue to checkout</button></div>'); }
    });</script>`;
  const frame = `<html data-baci-experience-build="${build}" data-baci-hydration="pending"><head><link rel="stylesheet" href="${base}/app.css"></head><body><button id="add">Add to bag</button><button id="review">Review checkout</button><script src="${base}/app.js"></script></body></html>`;
  return {
    version: 1,
    origin,
    product: { origin: 'https://project.supabase.co', merchantId, productId },
    expected: {
      buildDigest: build,
      scriptDigest: hash(js),
      styleDigest: hash(css),
      assets: { logo: hash('synthetic image') },
      routes: paths.map((path) => ({
        path,
        title: `Store ${path}`,
        canonical: `${origin}${path}`,
      })),
      product: { id: productId, path: '/products/device' },
    },
    resources: [
      resource(`${base}/app.js`, 'text/javascript', js),
      resource(`${base}/app.css`, 'text/css', css),
      resource(`${base}/assets/logo`, 'image/png', 'synthetic image'),
      ...paths.map((path) =>
        resource(`${origin}${path}`, 'text/html', parent(path))
      ),
      ...paths.map((path) =>
        resource(
          `${base}/index.html?path=${encodeURIComponent(path)}`,
          'text/html',
          frame
        )
      ),
    ],
  };
}
