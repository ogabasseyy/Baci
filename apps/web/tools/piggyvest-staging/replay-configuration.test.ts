import { expect, it, vi } from 'vitest';
import { readReplayConfiguration } from './replay-configuration';
import type { readProtectedReplayFile } from './replay-protected-file';

it('reads activation pins only from the fixed protected bounded configuration', async () => {
  const configuration = { prefundedReplay: { bundleSha256: 'a'.repeat(64) } };
  const read = vi
    .fn<typeof readProtectedReplayFile>()
    .mockResolvedValue(Buffer.from(JSON.stringify(configuration)));
  await expect(readReplayConfiguration(read)).resolves.toEqual(configuration);
  expect(read).toHaveBeenCalledExactlyOnceWith({
    path: '/run/pvb-replay/config.json',
    maximumBytes: 131_072,
    allowedModes: [0o400, 0o440, 0o600],
  });
});

it.each([
  Buffer.from('{'),
  Buffer.from([0xff]),
])('refuses malformed or non-UTF8 configuration without an unprotected fallback', async (bytes) => {
  const read = vi.fn<typeof readProtectedReplayFile>().mockResolvedValue(bytes);
  await expect(readReplayConfiguration(read)).rejects.toThrow(
    'Staging replay configuration unavailable'
  );
  expect(read).toHaveBeenCalledTimes(1);
});

it('redacts protected-reader errors instead of treating absent activation as legacy', async () => {
  const read = vi
    .fn<typeof readProtectedReplayFile>()
    .mockRejectedValue(new Error('private permissions and credential details'));
  await expect(readReplayConfiguration(read)).rejects.toThrow(
    'Staging replay configuration unavailable'
  );
  expect(read).toHaveBeenCalledTimes(1);
});
