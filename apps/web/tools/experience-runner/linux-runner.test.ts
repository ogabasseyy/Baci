import { expect, it, vi } from 'vitest';
import { createDirectOCITransport, createLinuxRunner } from './linux-runner';
import { runLocalQualification } from './local-oci-executor';

it('maps fixed OCI commands to noninteractive Linux execution, retaining isolation and cleanup', async () => {
  const command = vi.fn(async (_program: string, args: string[]) =>
    args.includes('run') ? '{"status":"synthetic"}' : ''
  );
  const result = await runLocalQualification(
    'compile',
    { source: 'synthetic' },
    createDirectOCITransport(command)
  );
  expect(result.output).toEqual({ status: 'synthetic' });
  const run = command.mock.calls.find(([, args]) => args.includes('run'));
  expect(run?.[0]).toBe('/usr/bin/sudo');
  expect(run?.[1]).toContain('--network=none');
  expect(run?.[1][0]).toBe('-n');
  expect(command.mock.calls.some(([, args]) => args.includes('delete'))).toBe(
    true
  );
  expect(
    command.mock.calls.every(([program]) => program === '/usr/bin/sudo')
  ).toBe(true);
});
it('refuses arbitrary host commands and refuses native startup on non-Linux machines', async () => {
  const command = vi.fn();
  await expect(
    createDirectOCITransport(command)(['ssh', '--', 'sudo', 'sh', '-c', 'bad'])
  ).rejects.toThrow('INVALID_RUNNER_COMMAND');
  expect(command).not.toHaveBeenCalled();
  await expect(
    createDirectOCITransport(command)([
      'ssh',
      '--',
      'sudo',
      'python3',
      '-c',
      'print("arbitrary")',
    ])
  ).rejects.toThrow('INVALID_RUNNER_COMMAND');
  await expect(
    createDirectOCITransport(command)([
      'ssh',
      '--',
      'sudo',
      '/usr/local/bin/runsc',
      'install',
    ])
  ).rejects.toThrow('INVALID_RUNNER_COMMAND');
  expect(command).not.toHaveBeenCalled();
  if (process.platform !== 'linux') {
    const verifyInstallation = vi.fn();
    await expect(
      createLinuxRunner({
        key: new Uint8Array(32),
        toolchainDigest: 'a'.repeat(64),
        verifyInstallation,
      })
    ).rejects.toThrow('LINUX_RUNNER_REQUIRED');
    expect(verifyInstallation).not.toHaveBeenCalled();
  }
});
