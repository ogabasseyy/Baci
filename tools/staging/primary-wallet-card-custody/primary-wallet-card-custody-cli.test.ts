import { beforeEach, describe, expect, it, vi } from 'vitest';
import { primaryCardCustodyCli } from './primary-wallet-card-custody-cli';

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
}));
vi.mock(
  '../../../apps/web/src/lib/piggyvest/primary-wallet-card-custody-launch',
  () => ({ runPrimaryCardCustodyLaunch: mocks.run })
);
vi.mock('node:fs/promises', () => ({ open: mocks.open }));
beforeEach(() => vi.resetAllMocks());
describe('standalone custody CLI', () => {
  it('rejects unknown modes without storage or provider actions', async () => {
    await expect(primaryCardCustodyCli(['--transfer'])).rejects.toThrow(
      'Usage'
    );
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it('uses no-follow bounded private files and always closes the handle', async () => {
    mocks.open.mockResolvedValue({
      stat: async () => ({
        isFile: () => true,
        nlink: 1,
        size: 2,
        mode: 0o600,
        uid: process.getuid?.(),
      }),
      readFile: async () => Buffer.from('{}'),
      close: mocks.close,
    });
    mocks.run.mockImplementation(async (input) => {
      expect(await input.readBinding('/fixture')).toEqual(Buffer.from('{}'));
      return { claimsMade: false };
    });
    expect(await primaryCardCustodyCli(['--readiness'])).toEqual({
      claimsMade: false,
    });
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it('rejects unsafe file permissions and propagates retry failure', async () => {
    mocks.open.mockResolvedValue({
      stat: async () => ({
        isFile: () => true,
        nlink: 1,
        size: 2,
        mode: 0o644,
        uid: 0,
      }),
      close: mocks.close,
    });
    mocks.run.mockImplementation(async (input) =>
      input.readBinding('/fixture')
    );
    await expect(primaryCardCustodyCli(['--once'])).rejects.toThrow('metadata');
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});
