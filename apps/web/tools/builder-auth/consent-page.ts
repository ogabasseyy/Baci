import { escapeAttribute, escapeText } from 'entities';
import type { ConsentState } from './linking.ts';

const storefrontPermissions = [
  ['storefront.read', 'Read your store and catalog'],
  ['storefront.write', 'Edit your private storefront draft'],
  ['storefront.publish', 'Request publication'],
] as const;

export function renderConsentPage(
  state: ConsentState,
  action: string,
  storeName: string | null
) {
  const title = state.ownedMerchantId
    ? 'Connect your Baci store'
    : 'Connect your Baci account';
  const store = state.ownedMerchantId
    ? `<p>Store: ${escapeText(storeName || state.ownedMerchantId)}.</p>`
    : '<p>No store is linked yet.</p>';
  const permissions = storefrontPermissions
    .filter(([scope]) => state.requestedScopes.includes(scope))
    .map(([scope, label]) => `<li>${label} (<code>${scope}</code>)</li>`)
    .join('');
  const canCreate =
    !state.ownedMerchantId &&
    state.requestedScopes.includes('storefront.write');
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<title>${title}</title>
<main>
  <h1>${title}</h1>
  <p>Baci Website Builder in ChatGPT is requesting access to this Baci account.</p>
  <p>Account: ${escapeText(state.actorUserId)}.</p>
  ${store}
  <h2>Requested permissions</h2>
  <ul>${permissions}</ul>
  <p>Publishing requires a separate confirmation in Baci.</p>
  <p>You can disconnect in Baci at any time. Offline access, when requested, allows this connection to renew until its expiry.</p>
  <form method="post" action="${escapeAttribute(action)}">
    <input type="hidden" name="csrf" value="${escapeAttribute(state.csrf)}">
    ${canCreate ? '<label><input type="checkbox" name="create" value="yes">Allow Baci Website Builder to create my private store</label>' : ''}
    <p><button name="decision" value="approve">Connect account</button> <button name="decision" value="deny">Cancel</button></p>
  </form>
</main>
</html>`;
}
