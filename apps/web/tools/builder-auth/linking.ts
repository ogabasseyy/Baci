import { timingSafeEqual } from 'node:crypto';
export interface ConsentState {
  actorUserId: string;
  ownedMerchantId: string | null;
  requestedScopes: string[];
  csrf: string;
  resource: string;
}
export function validateConsentPost(
  origin: string | undefined,
  expected: string,
  contentType: string | undefined
) {
  if (
    origin !== expected ||
    contentType?.split(';')[0] !== 'application/x-www-form-urlencoded'
  )
    throw new Error('Invalid consent request');
}
export function buildConsentDecision(
  state: ConsentState,
  form: URLSearchParams
) {
  const allowed = ['csrf', 'decision', 'create'];
  if (
    [...form.keys()].some(
      (k) => !allowed.includes(k) || form.getAll(k).length !== 1
    )
  )
    throw new Error('Invalid consent request');
  const actual = Buffer.from(form.get('csrf') ?? '');
  const expected = Buffer.from(state.csrf);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new Error('Invalid consent request');
  if (form.get('decision') === 'deny') return null;
  if (
    form.get('decision') !== 'approve' ||
    !state.requestedScopes.includes('storefront.read') ||
    state.requestedScopes.some(
      (s) =>
        !['storefront.read', 'storefront.write', 'storefront.publish'].includes(
          s
        )
    )
  )
    throw new Error('Invalid consent request');
  const create = form.get('create');
  if (create !== null && create !== 'yes')
    throw new Error('Invalid create consent');
  return {
    scopes: [...new Set(state.requestedScopes)] as (
      | 'storefront.read'
      | 'storefront.write'
      | 'storefront.publish'
    )[],
    allowedMerchantIds: state.ownedMerchantId ? [state.ownedMerchantId] : [],
    allowCreateStore:
      create === 'yes' && state.requestedScopes.includes('storefront.write'),
  };
}
