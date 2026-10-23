/** Candidate interoperability adapter, restricted to the exact OpenAI document. */
export const openaiClient = 'https://chatgpt.com/oauth/client.json';
export const openaiRedirect =
  'https://chatgpt.com/connector_platform_oauth_redirect';
export function selectClientMetadata(document) {
  if (
    !document ||
    document.client_id !== openaiClient ||
    !Array.isArray(document.redirect_uris) ||
    document.redirect_uris.length !== 1 ||
    document.redirect_uris[0] !== openaiRedirect
  )
    throw new Error('Untrusted client identity or callback');
  const declared = document.token_endpoint_auth_methods_supported;
  if (
    declared !== undefined &&
    (!Array.isArray(declared) ||
      declared.some((value) => typeof value !== 'string'))
  )
    throw new Error('Invalid authentication choices');
  const available = declared ?? [document.token_endpoint_auth_method];
  const preferred = document.token_endpoint_auth_method;
  // This proof supports public S256 clients only; private_key_jwt is not advertised.
  const selected =
    preferred === 'none' && available.includes(preferred)
      ? preferred
      : available.find((value) => value === 'none');
  if (!selected) throw new Error('No mutually supported authentication method');
  return {
    ...document,
    token_endpoint_auth_method: selected,
    id_token_signed_response_alg: 'ES256',
  };
}
