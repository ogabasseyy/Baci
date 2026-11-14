import 'server-only';
import type { getInstalledBuilderGateway } from '@/lib/builder-gateway/runtime';
import { createBuilderBackendClient } from '../../../builder-mcp-server/backend-client';

/** Trusted co-located transport; the gateway still authenticates every request. */
export function createProductionBuilderLocalForward(
  getGateway: typeof getInstalledBuilderGateway
) {
  return createBuilderBackendClient({
    fetchImpl: async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const match = /^\/api\/integrations\/chatgpt\/builder\/([a-z_]+)$/.exec(
        url.pathname
      );
      if (
        request.signal.aborted ||
        request.method !== 'POST' ||
        url.origin !== 'https://usebaci.com' ||
        url.search ||
        url.hash ||
        !match
      )
        throw Error('Invalid local gateway request');
      const gateway = getGateway();
      if (!gateway) throw Error('Builder gateway unavailable');
      return await gateway(request, match[1]);
    },
  });
}
