import {
  type StorefrontAgentUiEvent,
  storefrontAgentUiContract,
} from '@/schemas/storefront-agent-ui-contract';

import { acceptsAgentUi } from './accepts-agent-ui';
/**
 * Preserves the legacy text response unless the widget explicitly opts into
 * the versioned agent-UI transport.
 */
export async function negotiateChatAgentUiResponse(
  request: Request,
  response: Response,
  events: StorefrontAgentUiEvent[] = []
): Promise<Response> {
  if (!acceptsAgentUi(request)) return response;

  const text = await response.text();
  const payload = storefrontAgentUiContract.responseSchema.parse({
    events,
    text,
    version: 1,
  });
  const headers = new Headers(response.headers);
  headers.set(
    'Content-Type',
    `${storefrontAgentUiContract.mediaType}; charset=utf-8`
  );
  headers.set('Cache-Control', 'no-store');
  headers.delete('Content-Encoding');
  headers.delete('Content-Length');

  return new Response(JSON.stringify(payload), {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}
