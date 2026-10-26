import { escapeHtml } from '../../src/lib/sanitize-core.ts';
import type { ConsentState } from './linking.ts';
export function renderConsentPage(state: ConsentState, action: string) {
  const title = state.ownedMerchantId
    ? 'Connect your Baci store'
    : 'Connect your Baci account';
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><main><h1>${title}</h1><p>This connects your account to the Baci website builder in ChatGPT.</p><p>Account: ${escapeHtml(state.actorUserId)}. Store: ${escapeHtml(state.ownedMerchantId ?? 'not created yet')}.</p><p>You can disconnect in Baci at any time. Offline access, when requested, allows this connection to renew until its expiry.</p><p>Requested permissions: ${escapeHtml(state.requestedScopes.join(', '))}.</p><p>Publishing requires a separate confirmation in Baci. Your live website is unchanged by connecting.</p><form method="post" action="${escapeHtml(action)}"><input type="hidden" name="csrf" value="${escapeHtml(state.csrf)}">${state.requestedScopes.includes('storefront.write') ? '<label><input type="checkbox" name="create" value="yes">Allow creating my private store if I do not have an established store</label>' : ''}<p><button name="decision" value="approve">Connect account</button> <button name="decision" value="deny">Cancel</button></p></form></main></html>`;
}
