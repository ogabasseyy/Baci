export function createPrivateReplayFetch(
  target: 'receipt' | 'app',
  fetcher: typeof fetch = fetch
): typeof fetch {
  const binding = {
    receipt: {
      origin: 'http://127.0.0.1:4792',
      upstream: 'http://pvb-staging-receipts-rest:3000',
      rpcs: [
        '/rpc/piggyvest_staging_system_id',
        '/rpc/claim_piggyvest_staging_receipts',
        '/rpc/read_piggyvest_staging_receipt_signature',
        '/rpc/quarantine_piggyvest_staging_receipt',
        '/rpc/resolve_piggyvest_staging_receipt',
      ],
    },
    app: {
      origin: 'http://127.0.0.1:4793',
      upstream: 'http://baci-isolated-savings-rest-1:3000',
      rpcs: [
        '/rpc/piggyvest_staging_system_id',
        '/rpc/recognize_piggyvest_staging_inflow',
        '/rpc/resolve_piggyvest_staging_goal_mapping',
      ],
    },
  }[target];

  return async (input, init) => {
    try {
      const request = new Request(input, init);
      const source = new URL(request.url);
      if (
        !binding ||
        source.origin !== binding.origin ||
        !source.pathname.startsWith('/rest/v1/') ||
        source.username ||
        source.password
      ) {
        throw new Error('Invalid destination');
      }
      const path = source.pathname.slice('/rest/v1'.length);
      const allowedRpc =
        request.method === 'POST' &&
        binding.rpcs.includes(path) &&
        !source.search;
      if (!allowedRpc) {
        throw new Error('Invalid operation');
      }
      const destination = `${binding.upstream}${path}${source.search}`;
      const options: RequestInit & { duplex: 'half' } = {
        method: request.method,
        headers: request.headers,
        body: request.body,
        duplex: 'half',
        cache: request.cache,
        credentials: request.credentials,
        integrity: request.integrity,
        keepalive: request.keepalive,
        mode: request.mode,
        referrer: request.referrer,
        referrerPolicy: request.referrerPolicy,
      };
      const forwarded = new Request(destination, options);
      return await fetcher(forwarded, {
        redirect: 'error',
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]),
      });
    } catch {
      throw new Error('Private replay request failed');
    }
  };
}
