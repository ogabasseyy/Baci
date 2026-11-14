import { execFile } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { experienceRunnerInstallationPin } from '../../src/schemas/experience-runner-installation';
import {
  fileDigest,
  inventoryInstallationTree,
} from './installation-inventory';

const root = '/var/tmp/baci-experience-checkpoint-a';
const exec = promisify(execFile);
async function version(program: string, args: string[]) {
  const result = await exec(program, args, {
    timeout: 10000,
    maxBuffer: 4096,
    env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', NODE_ENV: 'production' },
  });
  return result.stdout.trim();
}
async function trustedPath(path: string) {
  const stat = await lstat(path);
  const stickyParent =
    path === '/var/tmp' && stat.isDirectory() && (stat.mode & 0o1000) !== 0;
  if (
    stat.isSymbolicLink() ||
    stat.uid !== 0 ||
    ((stat.mode & 0o022) !== 0 && !stickyParent)
  )
    throw Error('UNTRUSTED_INSTALLATION_PERMISSIONS');
}
/** Suitable for createLinuxRunner.verifyInstallation. No installation, network,
 * auto-pinning or fallback; compares both complete rootfs trees and runsc bytes. */
export function createPinnedLinuxInstallationVerifier(input: unknown) {
  const pin = experienceRunnerInstallationPin.parse(input);
  return async () => {
    if (process.platform !== 'linux') throw Error('LINUX_RUNNER_REQUIRED');
    for (const path of [
      '/var',
      '/var/tmp',
      root,
      `${root}/node24`,
      `${root}/browser`,
      `${root}/node24/rootfs`,
      `${root}/browser/rootfs`,
      '/usr',
      '/usr/local',
      '/usr/local/bin',
      '/usr/local/bin/runsc',
    ]) {
      await trustedPath(path);
    }
    const node24 = await inventoryInstallationTree(`${root}/node24/rootfs`);
    const browser = await inventoryInstallationTree(`${root}/browser/rootfs`);
    const runscDigest = await fileDigest('/usr/local/bin/runsc');
    if (
      node24.digest !== pin.rootfs.node24 ||
      browser.digest !== pin.rootfs.browser ||
      runscDigest !== pin.runscDigest
    )
      throw Error('INSTALLATION_DIGEST_MISMATCH');
    const compilerNode = await version('/usr/sbin/chroot', [
      `${root}/node24/rootfs`,
      '/usr/local/bin/node',
      '--version',
    ]);
    const captureNode = await version('/usr/sbin/chroot', [
      `${root}/browser/rootfs`,
      '/usr/local/bin/node',
      '--version',
    ]);
    const runsc = await version('/usr/local/bin/runsc', ['--version']);
    if (
      compilerNode !== pin.versions.compilerNode ||
      captureNode !== pin.versions.captureNode ||
      runsc.split('\n')[0] !== `runsc version ${pin.versions.runsc}`
    )
      throw Error('INSTALLATION_VERSION_MISMATCH');
    return {
      toolchainDigest: pin.toolchainDigest,
      rootfs: { node24, browser },
      runscDigest,
      versions: { compilerNode, captureNode, runsc },
    };
  };
}
