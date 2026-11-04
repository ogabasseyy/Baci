import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { readOxygenCallbackBacklog } from './runtime-callback-backlog';

it('accepts only bounded aggregate worker results', async () => {
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({
      error: null,
      data: { pendingCount: 1000, capped: true, oldestAgeSeconds: 42 },
    })
    .mockResolvedValueOnce({
      error: null,
      data: { pendingCount: 0, capped: false, oldestAgeSeconds: null },
    })
    .mockResolvedValueOnce({
      error: null,
      data: { pendingCount: 1001, capped: false, oldestAgeSeconds: 1 },
    });
  expect(await readOxygenCallbackBacklog({ rpc }, 'partner')).toEqual({
    pendingCount: 1000,
    capped: true,
    oldestAgeSeconds: 42,
  });
  expect(await readOxygenCallbackBacklog({ rpc }, 'partner')).toEqual({
    pendingCount: 0,
    capped: false,
    oldestAgeSeconds: null,
  });
  await expect(readOxygenCallbackBacklog({ rpc }, 'partner')).rejects.toThrow();
});
it('redacts worker errors and rejects impossible age/count combinations', async () => {
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ error: { code: 'private' }, data: null })
    .mockResolvedValueOnce({
      error: null,
      data: { pendingCount: 1, capped: false, oldestAgeSeconds: null },
    });
  await expect(readOxygenCallbackBacklog({ rpc }, 'partner')).rejects.toThrow(
    'Callback backlog unavailable'
  );
  await expect(readOxygenCallbackBacklog({ rpc }, 'partner')).rejects.toThrow();
});
