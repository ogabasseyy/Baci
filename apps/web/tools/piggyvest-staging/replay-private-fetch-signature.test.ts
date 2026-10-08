import { expect, it, vi } from 'vitest';
import { createPrivateReplayFetch } from './replay-private-fetch';

const path = '/rpc/read_piggyvest_staging_receipt_signature';

it('allows only the receipt signature RPC and preserves its exact lease-bound request', async () => {
  const response = new Response('null');
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
  const body = JSON.stringify({
    p_receipt_id: '10000000-0000-4000-8000-000000000001',
    p_payload_sha256: 'a'.repeat(64),
    p_claim_token: '20000000-0000-4000-8000-000000000001',
  });
  expect(
    await createPrivateReplayFetch('receipt', fetcher)(
      `http://127.0.0.1:4792/rest/v1${path}`,
      {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json' },
      }
    )
  ).toBe(response);
  expect(fetcher).toHaveBeenCalledOnce();
  const [input, init] = fetcher.mock.calls[0];
  const forwarded = new Request(input, init);
  expect(forwarded.url).toBe(`http://pvb-staging-receipts-rest:3000${path}`);
  expect(forwarded.method).toBe('POST');
  expect(forwarded.redirect).toBe('error');
  expect(await forwarded.text()).toBe(body);
});

it.each([
  ['app', '4793', 'POST', path],
  ['receipt', '4792', 'GET', path],
  ['receipt', '4792', 'PATCH', path],
  ['receipt', '4792', 'POST', `${path}?select=signature`],
  ['receipt', '4792', 'POST', `${path}/`],
  ['receipt', '4792', 'POST', '/rpc/record_provider_evidence'],
  ['receipt', '4792', 'POST', '/piggyvest_staging_receipt_signatures'],
] as const)('refuses %s %s %s %s without widening authority', async (target, port, method, requestPath) => {
  const fetcher = vi.fn<typeof fetch>();
  await expect(
    createPrivateReplayFetch(target, fetcher)(
      `http://127.0.0.1:${port}/rest/v1${requestPath}`,
      { method }
    )
  ).rejects.toThrow('Private replay request failed');
  expect(fetcher).not.toHaveBeenCalled();
});
