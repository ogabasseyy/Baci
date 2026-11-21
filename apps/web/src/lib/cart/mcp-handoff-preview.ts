import { getCartProofEnvironment } from './cart-runtime-env';
import { parseHandoffToken } from './handoff-token';

/** Only server-signed MCP website links opt into an automatic import. */
export function isMcpWebsiteHandoff(token: string): boolean {
  try {
    const handoff = parseHandoffToken(
      token,
      undefined,
      getCartProofEnvironment()
    );
    return (
      handoff?.destination.type === 'web' &&
      handoff.principalId.startsWith('legacy:mcp:') &&
      handoff.operationId.startsWith('legacy-handoff:')
    );
  } catch {
    // The optional UI hint never invalidates an otherwise usable preview.
    return false;
  }
}
