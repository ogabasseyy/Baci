import { execFileSync } from 'node:child_process';
/** This builder prepares the existing Mac/Colima fixture, never a generic Linux installer. */
export function assertLocalQualificationHost({
  platform = process.platform,
  run = execFileSync,
} = {}) {
  const message =
    'Local experience browser qualification requires macOS, a running Colima VM and the pre-provisioned gVisor rootfs layout. Use the separately qualified native Linux runner for deployed execution; no host-execution fallback is available.';
  if (platform !== 'darwin') throw Error(message);
  try {
    run('colima', ['status'], {
      timeout: 10000,
      stdio: 'ignore',
      env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8' },
    });
  } catch {
    throw Error(message);
  }
}
