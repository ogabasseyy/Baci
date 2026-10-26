// @vitest-environment node
import { expect, it, vi } from 'vitest';
import {
  createSafePublicationFetcher,
  isPublicPublicationAddress,
} from './publication-fetch';

it('rejects private, loopback, mapped, link-local and mixed DNS answers without fetching', async () => {
  for (const address of [
    '127.0.0.1',
    '10.1.2.3',
    '169.254.169.254',
    '::1',
    '::ffff:127.0.0.1',
    'fd00::1',
    'fe80::1',
    '2002:7f00:1::',
  ])
    expect(isPublicPublicationAddress(address)).toBe(false);
  expect(isPublicPublicationAddress('1.1.1.1')).toBe(true);
  const resolver = vi.fn().mockResolvedValue([
    { address: '1.1.1.1', family: 4 },
    { address: '127.0.0.1', family: 4 },
  ]);
  const fetcher = createSafePublicationFetcher({ resolve: resolver });
  await expect(
    fetcher('https://approval-fixture.usebaci.com/')
  ).rejects.toThrow('Unsafe');
  for (const url of [
    'http://approval-fixture.usebaci.com',
    'https://user:secret@approval-fixture.usebaci.com',
    'https://127.0.0.1/',
    'https://evil.example/',
    'https://approval-fixture.usebaci.com:444/',
  ])
    await expect(fetcher(url)).rejects.toThrow();
});

it('bounds DNS resolution before opening a public request', async () => {
  vi.useFakeTimers();
  try {
    const pending = createSafePublicationFetcher({
      resolve: () => new Promise(() => {}),
    })('https://approval-fixture.usebaci.com/');
    const rejection = expect(pending).rejects.toThrow(
      'Publication DNS timeout'
    );
    await vi.advanceTimersByTimeAsync(5000);
    await rejection;
  } finally {
    vi.useRealTimers();
  }
});

it('accepts canonical short store hosts while keeping DNS and hostname bounds', async () => {
  const resolve = vi
    .fn()
    .mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
  const fetcher = createSafePublicationFetcher({ resolve });
  for (const slug of ['a', 'ab', 'a'.repeat(63)])
    await expect(fetcher(`https://${slug}.usebaci.com/`)).rejects.toThrow(
      'Unsafe publication DNS'
    );
  expect(resolve).toHaveBeenCalledTimes(3);
  for (const slug of ['-a', 'a-', 'a'.repeat(64)])
    await expect(fetcher(`https://${slug}.usebaci.com/`)).rejects.toThrow(
      'Unsafe publication resource'
    );
  expect(resolve).toHaveBeenCalledTimes(3);
});
