import {
  type CustomerSavingsDraftScope,
  type CustomerSavingsDraftSelection,
  customerSavingsDraftPublic as schemas,
} from '@/schemas/customer-savings-draft-public';

export async function customerSavingsDraftBrowserRequestId(
  scope: CustomerSavingsDraftScope,
  selection: CustomerSavingsDraftSelection,
  expectedOldRequestId?: string
) {
  const { merchantId, userId } = schemas.scope.parse(scope);
  const { productId, variantId } = schemas.selection.parse(selection);
  const key = `customer-savings-draft:${JSON.stringify([location.origin, userId, merchantId, productId, variantId])}`;
  if (!navigator.locks)
    throw new Error('Safe browser draft storage is unavailable.');
  return await navigator.locks.request(key, { mode: 'exclusive' }, () => {
    const saved = localStorage.getItem(key);
    if (expectedOldRequestId !== undefined && saved !== expectedOldRequestId)
      throw new Error('The retained request changed. Reopen your draft.');
    if (saved !== null && expectedOldRequestId === undefined)
      return schemas.draft.shape.requestId.parse(saved);
    const created = crypto.randomUUID();
    localStorage.setItem(key, created);
    if (localStorage.getItem(key) !== created)
      throw new Error('Unable to retain the request.');
    return created;
  });
}
