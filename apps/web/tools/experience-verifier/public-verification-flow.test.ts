import { expect, it, vi } from 'vitest';
import { fetchPublicPages } from './public-page-fetch';
import { createPublicVerificationFlow } from './public-verification-flow';

const a = 'a'.repeat(64);
const b = 'b'.repeat(64);
const c = 'c'.repeat(64);
const binding = {
  receiptId: '10000000-0000-4000-8000-000000000001',
  effectDigest: a,
  buildDigest: a,
  publicationRevision: 1,
  scriptDigest: b,
  styleDigest: c,
  assets: {},
};
const steps = [
  { action: 'navigate' as const, path: '/' },
  { action: 'product' as const, path: '/products/device' },
  { action: 'cart-add' as const, path: '/products/device' },
  { action: 'cart-read' as const, path: '/cart' },
  { action: 'checkout-review' as const, path: '/checkout' },
];
const expected = {
  ...binding,
  routes: [{ path: '/', canonical: 'https://shop.example/', title: 'Shop' }],
  journeySteps: steps,
};
const observation = {
  parentBuild: a,
  frameBuild: a,
  scriptDigest: b,
  styleDigest: c,
  assets: {},
  routes: [{ ...expected.routes[0], status: 200 }],
  journey: {
    steps: steps.map((step) => ({ ...step, evidenceDigest: c })),
    orderRequests: 0,
    paymentRequests: 0,
  },
  evidenceDigest: c,
};
function setup() {
  const bind = vi.fn(async () => ({ ...binding }));
  const fetchOutput = vi.fn(async () => [{ path: 'app.js' }]);
  const deriveExpected = vi.fn(async () => expected);
  const fetchPages = vi.fn(async () => [{ path: '/', digest: c }]);
  const observe = vi.fn(async () => observation);
  const record = vi.fn(async () => {});
  return { bind, fetchOutput, deriveExpected, fetchPages, observe, record };
}
it('checks bound output and a complete browser observation before recording the still-current receipt', async () => {
  const deps = setup();
  await expect(
    createPublicVerificationFlow(deps)('approval')
  ).resolves.toMatchObject({ status: 'verified' });
  expect(deps.fetchOutput).toHaveBeenCalledOnce();
  expect(deps.observe).toHaveBeenCalledOnce();
  expect(deps.observe).toHaveBeenCalledWith(
    binding,
    [{ path: 'app.js' }],
    [{ path: '/', digest: c }],
    expected
  );
  expect(deps.bind).toHaveBeenCalledTimes(2);
  expect(deps.record).toHaveBeenCalledWith(
    expect.objectContaining({
      receiptId: binding.receiptId,
      effectDigest: a,
      markerDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
  );
});
it('never records for a changed receipt or mismatched trusted expectation', async () => {
  const changed = setup();
  changed.bind
    .mockResolvedValueOnce({ ...binding })
    .mockResolvedValueOnce({ ...binding, effectDigest: b });
  await expect(
    createPublicVerificationFlow(changed)('approval')
  ).rejects.toThrow();
  expect(changed.record).not.toHaveBeenCalled();
  const wrong = setup();
  wrong.deriveExpected.mockResolvedValueOnce({ ...expected, scriptDigest: a });
  await expect(
    createPublicVerificationFlow(wrong)('approval')
  ).rejects.toThrow();
  expect(wrong.observe).not.toHaveBeenCalled();
  expect(wrong.record).not.toHaveBeenCalled();
});
it('fails closed when output acquisition or browser verification fails', async () => {
  const unavailable = setup();
  unavailable.fetchOutput.mockRejectedValueOnce(Error('unavailable'));
  await expect(
    createPublicVerificationFlow(unavailable)('approval')
  ).rejects.toThrow();
  expect(unavailable.observe).not.toHaveBeenCalled();
  expect(unavailable.record).not.toHaveBeenCalled();
  const badPage = setup();
  badPage.fetchPages.mockRejectedValueOnce(Error('PUBLIC_PAGE_MISMATCH'));
  await expect(
    createPublicVerificationFlow(badPage)('approval')
  ).rejects.toThrow();
  expect(badPage.observe).not.toHaveBeenCalled();
  expect(badPage.record).not.toHaveBeenCalled();
  const unsafe = setup();
  unsafe.observe.mockResolvedValueOnce({
    ...observation,
    journey: { ...observation.journey, orderRequests: 1 },
  });
  await expect(
    createPublicVerificationFlow(unsafe)('approval')
  ).rejects.toThrow();
  expect(unsafe.record).not.toHaveBeenCalled();
});

it('passes validated public document bytes to the observer and fails before recording on metadata mismatch', async () => {
  const deps = setup();
  const network = vi.fn(async () => ({
    response: new Response(
      '<html><head><title>Shop</title><link rel="canonical" href="https://shop.example/"></head><body>Store</body></html>',
      {
        headers: {
          'content-type': 'text/html',
          'content-security-policy': "default-src 'self'",
          'set-cookie': 'private=secret',
        },
      }
    ),
    close: async () => {},
  }));
  const fetchPages = (_binding: typeof binding, plan: typeof expected) =>
    fetchPublicPages('https://shop.example', plan.routes, {
      resolve: async () => [{ address: '8.8.8.8', family: 4 }],
      network,
    });
  await expect(
    createPublicVerificationFlow({ ...deps, fetchPages })('approval')
  ).resolves.toMatchObject({ status: 'verified' });
  expect(deps.observe).toHaveBeenCalledWith(
    binding,
    [{ path: 'app.js' }],
    expect.arrayContaining([
      expect.objectContaining({
        path: '/',
        bytes: expect.any(Buffer),
        digest: expect.any(String),
        securityHeaders: { 'content-security-policy': "default-src 'self'" },
      }),
    ]),
    expected
  );
  deps.record.mockClear();
  network.mockResolvedValueOnce({
    response: new Response('<title>Wrong</title>', {
      headers: { 'content-type': 'text/html' },
    }),
    close: async () => {},
  });
  await expect(
    createPublicVerificationFlow({ ...deps, fetchPages })('approval')
  ).rejects.toThrow('PUBLIC_PAGE_MISMATCH');
  expect(deps.record).not.toHaveBeenCalled();
});
