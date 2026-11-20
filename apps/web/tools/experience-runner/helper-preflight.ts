import { z } from 'zod';
import type { LinuxRunnerCommand } from './linux-runner';

const receipt = z.strictObject({
  toolchainDigest: z.string().regex(/^[a-f0-9]{64}$/),
});

/** The privileged helper reads the protected pin; no caller path is accepted. */
export function createHelperPreflight(command: LinuxRunnerCommand) {
  return async () => {
    const text = await command(
      '/usr/bin/sudo',
      ['-n', '/usr/local/libexec/baci-experience-helper', 'preflight'],
      undefined,
      900000
    );
    try {
      if (Buffer.byteLength(text) > 65536) throw Error();
      return receipt.parse(JSON.parse(text));
    } catch {
      throw Error('INVALID_PREFLIGHT_RECEIPT');
    }
  };
}
