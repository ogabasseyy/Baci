import { registerCartLinkTools } from './cart-link-tool';
import { registerConnectedCartRead } from './register-connected-cart-read';
import type { McpServer } from '@modelcontextprotocol/server';
import { registerGuestCartTool } from './guest-cart-tool';
import { privateCartContinuationEnabled } from './private-cart-continuation-config';

/** The production and QA registration boundary shares one default-off policy. */
export function registerConfiguredGuestCartTool(
  server: McpServer,
  options: Omit<Parameters<typeof registerGuestCartTool>[1], 'enablePrivateTextContinuation'>
) {
  registerGuestCartTool(server, {
    ...options,
    enablePrivateTextContinuation: privateCartContinuationEnabled(),
  });
  if (options.connectionCart) {
    registerConnectedCartRead(server, options.store, options.connectionCart);
  } else {
    // Stateless links are only for legacy callers. Connected shoppers use the
    // persistent cart tools so additions, removals and handoffs share one cart.
    registerCartLinkTools(server, options);
  }
}
