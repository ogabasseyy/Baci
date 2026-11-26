export const a = 'a'.repeat(64);
export const binding = {
  receiptId: 'receipt',
  effectDigest: a,
  buildDigest: a,
  publicationRevision: 1,
  scriptDigest: a,
  styleDigest: a,
  assets: {},
  canonicalBase: 'https://shop.example',
};
const steps = [
  { action: 'navigate', path: '/' },
  { action: 'product', path: '/products/device' },
  { action: 'cart-add', path: '/products/device' },
  { action: 'cart-read', path: '/cart' },
  { action: 'checkout-review', path: '/checkout' },
] as const;
export const plan = {
  ...binding,
  routes: [{ path: '/', canonical: 'https://shop.example/', title: 'Shop' }],
  journeySteps: [...steps],
  product: {
    id: '33333333-3333-4333-8333-333333333333',
    slug: 'device',
    path: '/products/device',
  },
};
export const observation = {
  parentBuild: a,
  frameBuild: a,
  scriptDigest: a,
  styleDigest: a,
  assets: {},
  routes: [{ ...plan.routes[0], status: 200 }],
  journey: {
    steps: steps.map((step) => ({ ...step, evidenceDigest: a })),
    orderRequests: 0,
    paymentRequests: 0,
  },
  evidenceDigest: a,
};
