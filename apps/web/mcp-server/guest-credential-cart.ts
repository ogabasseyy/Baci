export function guestCredentialModeEnabled(
  canonicalEnabled: boolean,
  env: Readonly<Record<string, string | undefined>> = process.env
): boolean {
  if (env.BACI_MCP_GUEST_CREDENTIAL_ENABLED !== 'true') return false;
  if (
    !canonicalEnabled ||
    env.BACI_MCP_GUEST_OAUTH_ENABLED === 'true' ||
    ['true', '1'].includes(env.MCP_ENABLE_AGENTIC_CHECKOUT_TOOLS ?? '')
  ) {
    throw new Error(
      'Guest credential mode requires the canonical bridge and a cart-only MCP instance without guest OAuth'
    );
  }
  return true;
}
