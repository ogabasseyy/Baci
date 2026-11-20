import { expect, it, vi } from 'vitest';
import { startRunnerService } from './runner-service';

it('does not open a socket when installation preflight fails', async () => {
  const socket = vi.fn();
  const verify = vi.fn(async () => {
    throw Error('untrusted installation');
  });
  await expect(
    startRunnerService(
      {
        key: new Uint8Array(32),
        toolchainDigest: 'a'.repeat(64),
        socketPath: '/run/baci-runner/runner.sock',
        verifyInstallation: verify,
      },
      {
        createRunner: async ({ verifyInstallation }) => {
          await verifyInstallation();
          return async () => new Response();
        },
        createSocket: socket,
      }
    )
  ).rejects.toThrow('untrusted installation');
  expect(verify).toHaveBeenCalledOnce();
  expect(socket).not.toHaveBeenCalled();
});
