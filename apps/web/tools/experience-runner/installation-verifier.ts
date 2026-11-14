import { execFile } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import { dirname } from 'node:path';
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
/** Resolve only fixed system locations and check the whole resolved path. */
export async function resolveTrustedChroot() {
  for (const candidate of ['/usr/bin/chroot', '/usr/sbin/chroot']) {
    let resolved: string;
    try {
      resolved = await realpath(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (!resolved.startsWith('/usr/') || resolved.endsWith('/'))
      throw Error('UNTRUSTED_CHROOT');
    await trustedPath(dirname(candidate));
    const pieces = resolved.split('/').filter(Boolean);
    let path = '';
    for (const piece of pieces) {
      path += `/${piece}`;
      await trustedPath(path);
    }
    if (!(await lstat(resolved)).isFile()) throw Error('UNTRUSTED_CHROOT');
    return resolved;
  }
  throw Error('CHROOT_UNAVAILABLE');
}
/** Suitable for createLinuxRunner.verifyInstallation. No installation, network,
 * auto-pinning or fallback; compares rootfs trees and the complete gVisor runtime. */
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
      '/usr/local/bin/gvisor-bin',
    ]) {
      await trustedPath(path);
    }
    const node24 = await inventoryInstallationTree(`${root}/node24/rootfs`);
    const browser = await inventoryInstallationTree(`${root}/browser/rootfs`);
    const gvisorBin = await inventoryInstallationTree(
      '/usr/local/bin/gvisor-bin'
    );
    const runscDigest = await fileDigest('/usr/local/bin/runsc');
    if (
      node24.digest !== pin.rootfs.node24 ||
      browser.digest !== pin.rootfs.browser ||
      runscDigest !== pin.runscDigest ||
      gvisorBin.digest !== pin.gvisorBinDigest
    )
      throw Error('INSTALLATION_DIGEST_MISMATCH');
    const chroot = await resolveTrustedChroot();
    const compilerNode = await version(chroot, [
      `${root}/node24/rootfs`,
      '/usr/local/bin/node',
      '--version',
    ]);
    const captureNode = await version(chroot, [
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
      gvisorBin,
      versions: { compilerNode, captureNode, runsc },
    };
  };
}
