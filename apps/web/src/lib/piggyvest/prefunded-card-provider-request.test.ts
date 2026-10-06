import { expect, it, vi } from 'vitest';
import { requestPrefundedCardProviderJson } from './prefunded-card-provider-request';

it('cancels an unbounded response stream as soon as it exceeds the byte cap', async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(1025));
    },
    cancel,
  });

  await expect(
    requestPrefundedCardProviderJson({
      url: 'https://api.paystack.co/transaction/verify/reference',
      token: 'sk_test_example',
      timeoutMs: 100,
      maxResponseBytes: 1024,
      fetchImplementation: vi
        .fn()
        .mockResolvedValue(new Response(body, { status: 200 })),
      init: { method: 'GET' },
    })
  ).rejects.toThrow('PROVIDER_RESPONSE_TOO_LARGE');
  expect(cancel).toHaveBeenCalled();
});

it('aborts a provider request at the configured timeout', async () => {
  await expect(
    requestPrefundedCardProviderJson({
      url: 'https://api.paystack.co/transaction/verify/reference',
      token: 'sk_test_example',
      timeoutMs: 1,
      maxResponseBytes: 1024,
      fetchImplementation: vi.fn(() => new Promise<Response>(() => undefined)),
      init: { method: 'GET' },
    })
  ).rejects.toThrow('PROVIDER_TIMEOUT');
});

it('rejects a redirected response without parsing its body', async () => {
  const response = new Response(JSON.stringify({ status: true }), {
    status: 200,
  });
  Object.defineProperty(response, 'redirected', { value: true });

  await expect(
    requestPrefundedCardProviderJson({
      url: 'https://api.paystack.co/transaction/verify/reference',
      token: 'sk_test_example',
      timeoutMs: 100,
      maxResponseBytes: 1024,
      fetchImplementation: vi.fn().mockResolvedValue(response),
      init: { method: 'GET' },
    })
  ).rejects.toThrow('PROVIDER_HTTP_ERROR');
});
