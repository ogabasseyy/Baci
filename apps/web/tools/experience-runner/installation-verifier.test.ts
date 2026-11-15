import { execFile } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import {
  fileDigest,
  inventoryInstallationTree,
} from './installation-inventory';
import { createPinnedLinuxInstallationVerifier } from './installation-verifier';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
vi.mock('node:util', () => ({ promisify: (fn: unknown) => fn }));
vi.mock('node:fs/promises', () => ({ lstat: vi.fn() }));
vi.mock('./installation-inventory', () => ({
  fileDigest: vi.fn(),
  inventoryInstallationTree: vi.fn(),
}));
const platform = process.platform;
afterEach(() => {
  Object.defineProperty(process, 'platform', { value: platform });
  vi.resetAllMocks();
});
const pin = {
  format: 'baci.runner-installation-pin/v1',
  toolchainDigest: 'a'.repeat(64),
  rootfs: { node24: 'b'.repeat(64), browser: 'c'.repeat(64) },
  runscDigest: 'd'.repeat(64),
  versions: {
    compilerNode: 'v24.21.0',
    captureNode: 'v24.20.0',
    runsc: 'release-20261019.0',
  },
};
function fixture() {
  Object.defineProperty(process, 'platform', { value: 'linux' });
  vi.mocked(lstat).mockResolvedValue({
    uid: 0,
    mode: 0o755,
    isSymbolicLink: () => false,
    isDirectory: () => true,
  } as never);
  vi.mocked(inventoryInstallationTree).mockImplementation(async (path) => ({
    digest: path.includes('/node24/') ? pin.rootfs.node24 : pin.rootfs.browser,
    entries: 100,
    bytes: 1000,
  }));
  vi.mocked(fileDigest).mockResolvedValue(pin.runscDigest);
  vi.mocked(execFile).mockImplementation((async (
    _program: string,
    args: string[]
  ) => ({
    stdout: args[0].includes('/node24/')
      ? 'v24.21.0'
      : args[0].includes('/browser/')
        ? 'v24.20.0'
        : 'runsc version release-20261019.0\nspec: 1.2.0',
  })) as never);
}
it('measures both trees, runtime bytes and versions before returning the trusted toolchain binding', async () => {
  fixture();
  const result = await createPinnedLinuxInstallationVerifier(pin)();
  expect(result.toolchainDigest).toBe(pin.toolchainDigest);
  expect(inventoryInstallationTree).toHaveBeenCalledTimes(2);
  expect(fileDigest).toHaveBeenCalledWith('/usr/local/bin/runsc');
  expect(execFile).toHaveBeenCalledTimes(3);
});
it('fails closed on byte drift before invoking any installed executable', async () => {
  fixture();
  vi.mocked(fileDigest).mockResolvedValue('e'.repeat(64));
  await expect(createPinnedLinuxInstallationVerifier(pin)()).rejects.toThrow(
    'INSTALLATION_DIGEST_MISMATCH'
  );
  expect(execFile).not.toHaveBeenCalled();
});
it('rejects writable installation paths and version drift', async () => {
  fixture();
  vi.mocked(lstat).mockResolvedValue({
    uid: 0,
    mode: 0o777,
    isSymbolicLink: () => false,
    isDirectory: () => true,
  } as never);
  await expect(createPinnedLinuxInstallationVerifier(pin)()).rejects.toThrow(
    'UNTRUSTED_INSTALLATION_PERMISSIONS'
  );
  expect(inventoryInstallationTree).not.toHaveBeenCalled();
  fixture();
  vi.mocked(execFile).mockImplementation((async () => ({
    stdout: 'unexpected',
  })) as never);
  await expect(createPinnedLinuxInstallationVerifier(pin)()).rejects.toThrow(
    'INSTALLATION_VERSION_MISMATCH'
  );
});
it('rejects malformed pins and native startup on unsupported hosts', async () => {
  expect(() =>
    createPinnedLinuxInstallationVerifier({
      ...pin,
      rootfs: { node24: 'bad', browser: 'bad' },
    })
  ).toThrow();
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  await expect(createPinnedLinuxInstallationVerifier(pin)()).rejects.toThrow(
    'LINUX_RUNNER_REQUIRED'
  );
});

it('requires a sticky root-owned directory for the writable /var/tmp parent', async () => {
  fixture();
  vi.mocked(lstat).mockImplementation(
    async (path) =>
      ({
        uid: 0,
        mode: path === '/var/tmp' ? 0o777 : 0o755,
        isSymbolicLink: () => false,
        isDirectory: () => true,
      }) as never
  );
  await expect(createPinnedLinuxInstallationVerifier(pin)()).rejects.toThrow(
    'UNTRUSTED_INSTALLATION_PERMISSIONS'
  );
  expect(inventoryInstallationTree).not.toHaveBeenCalled();
  vi.mocked(lstat).mockImplementation(
    async (path) =>
      ({
        uid: 0,
        mode: path === '/var/tmp' ? 0o1777 : 0o755,
        isSymbolicLink: () => false,
        isDirectory: () => true,
      }) as never
  );
  await expect(
    createPinnedLinuxInstallationVerifier(pin)()
  ).resolves.toHaveProperty('toolchainDigest', pin.toolchainDigest);
});
