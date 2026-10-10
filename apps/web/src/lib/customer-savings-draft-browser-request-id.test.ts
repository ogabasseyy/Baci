import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { savingsDraftFixture } from './customer-savings-draft.test-fixture';
import { customerSavingsDraftBrowserRequestId } from './customer-savings-draft-browser-request-id';

const fixture = savingsDraftFixture();
const scope = {
  merchantId: fixture.merchantId,
  userId: fixture.record.draftId,
};
const selection = {
  productId: fixture.record.productId,
  variantId: fixture.record.variantId,
};
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('navigator', {
    locks: {
      request: async (
        _key: string,
        _options: unknown,
        operation: () => string
      ) => operation(),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());
it('retains one scoped request across retries and rotates only a matching old request', async () => {
  const first = await customerSavingsDraftBrowserRequestId(scope, selection);
  expect(await customerSavingsDraftBrowserRequestId(scope, selection)).toBe(
    first
  );
  const next = await customerSavingsDraftBrowserRequestId(
    scope,
    selection,
    first
  );
  expect(next).not.toBe(first);
  await expect(
    customerSavingsDraftBrowserRequestId(scope, selection, first)
  ).rejects.toThrow();
  expect(await customerSavingsDraftBrowserRequestId(scope, selection)).toBe(
    next
  );
  expect(
    await customerSavingsDraftBrowserRequestId(
      { ...scope, userId: fixture.record.productId },
      selection
    )
  ).not.toBe(next);
  expect(
    await customerSavingsDraftBrowserRequestId(scope, {
      ...selection,
      variantId: null,
    })
  ).not.toBe(next);
});
it('does not dispatch a new identity when storage is corrupt or unavailable', async () => {
  await customerSavingsDraftBrowserRequestId(scope, selection);
  const key = localStorage.key(0);
  if (!key) throw new Error('fixture');
  localStorage.setItem(key, 'corrupt');
  await expect(
    customerSavingsDraftBrowserRequestId(scope, selection)
  ).rejects.toThrow();
  vi.stubGlobal('navigator', {});
  await expect(
    customerSavingsDraftBrowserRequestId(scope, selection)
  ).rejects.toThrow();
});
