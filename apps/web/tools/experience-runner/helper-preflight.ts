import { runnerPreflightReceipt } from '@/schemas/experience-operator-config';
import type { LinuxRunnerCommand } from './linux-runner';

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
      return runnerPreflightReceipt.parse(JSON.parse(text));
    } catch {
      throw Error('INVALID_PREFLIGHT_RECEIPT');
    }
  };
}
