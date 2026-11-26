import { expect, it, vi } from 'vitest';
import {
  publicNetworkSignal,
  readPublicBody,
  resolvePublicAddress,
} from './public-network-lifetime';

const ipv4 = { address: '8.8.8.8', family: 4 };
const ipv6 = { address: '2001:4860:4860::8888', family: 6 };

it('prefers IPv4 when all returned addresses are public', async () => {
  await expect(
    resolvePublicAddress('shop.example', undefined, async () => [ipv6, ipv4])
  ).resolves.toEqual(ipv4);
  await expect(
    resolvePublicAddress('shop.example', undefined, async () => [ipv6])
  ).resolves.toEqual(ipv6);
});

it('rejects a DNS set containing even one private address', async () => {
  await expect(
    resolvePublicAddress('shop.example', undefined, async () => [
      ipv4,
      { address: '192.168.0.2', family: 4 },
    ])
  ).rejects.toThrow('PUBLIC_DNS_DENIED');
});

it('forwards cancellation to a pending DNS lookup', async () => {
  const controller = new AbortController();
  const lookup = vi.fn(
    (_host: string, signal: AbortSignal) =>
      new Promise<(typeof ipv4)[]>((resolve) => {
        signal.addEventListener('abort', () => resolve([ipv4]), { once: true });
      })
  );
  const result = resolvePublicAddress(
    'shop.example',
    controller.signal,
    lookup
  );
  expect(lookup).toHaveBeenCalledOnce();

  const cancelled = Error('SYNTHETIC_REQUEST_CANCELLED');
  controller.abort(cancelled);
  await expect(result).rejects.toBe(cancelled);
});

it('preserves the caller abort reason in the deadline signal', () => {
  const controller = new AbortController();
  const combined = publicNetworkSignal(15000, controller.signal);
  const reason = Error('SYNTHETIC_REQUEST_CANCELLED');
  controller.abort(reason);
  expect(combined.reason).toBe(reason);
});

it('accounts for each chunk and releases the read lock on success', async () => {
  const body = new ReadableStream<Uint8Array>({
    start(stream) {
      stream.enqueue(Buffer.from('Baci'));
      stream.enqueue(Buffer.from(' shop'));
      stream.close();
    },
  });
  const accepted = vi.fn();
  await expect(
    readPublicBody(body, new AbortController().signal, accepted)
  ).resolves.toEqual(Buffer.from('Baci shop'));
  expect(accepted.mock.calls).toEqual([[4], [5]]);
  expect(body.locked).toBe(false);
});

it('cancels a pending body read and releases the lock when the request aborts', async () => {
  const controller = new AbortController();
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ cancel });
  const accepted = vi.fn();
  const reading = readPublicBody(body, controller.signal, accepted);
  expect(body.locked).toBe(true);

  const reason = Error('SYNTHETIC_REQUEST_CANCELLED');
  controller.abort(reason);
  await expect(reading).rejects.toBe(reason);
  expect(accepted).not.toHaveBeenCalled();
  expect(cancel).toHaveBeenCalledOnce();
  expect(body.locked).toBe(false);
});

it('discards the body and releases its lock when a chunk exceeds the byte budget', async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(stream) {
      stream.enqueue(Uint8Array.of(1, 2));
      stream.enqueue(Uint8Array.of(3, 4));
    },
    cancel,
  });
  let acceptedBytes = 0;
  const budgetError = Error('SYNTHETIC_BODY_BUDGET_EXCEEDED');
  await expect(
    readPublicBody(body, new AbortController().signal, (size) => {
      acceptedBytes += size;
      if (acceptedBytes > 3) throw budgetError;
    })
  ).rejects.toBe(budgetError);
  expect(acceptedBytes).toBe(4);
  expect(cancel).toHaveBeenCalledOnce();
  expect(body.locked).toBe(false);
});
