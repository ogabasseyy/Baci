import { beforeEach, vi } from 'vitest';

const operations = vi.hoisted(() => ({
  close: vi.fn(),
  writeFile: vi.fn(),
  rm: vi.fn(),
  rename: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  open: vi.fn(async () => ({
    close: operations.close,
    writeFile: operations.writeFile,
  })),
  rename: operations.rename,
  rm: operations.rm,
}));

import { writeEvidenceAtomically } from './atomic-evidence-write';

beforeEach(() => {
  vi.resetAllMocks();
});

it('removes its temporary file even when closing it fails', async () => {
  operations.close.mockRejectedValue(new Error('close failed'));
  await expect(
    writeEvidenceAtomically('/tmp/evidence.json', '{}')
  ).rejects.toThrow('close failed');
  expect(operations.rm).toHaveBeenCalledWith(
    expect.stringMatching(/^\/tmp\/evidence\.json\..+\.tmp$/),
    { force: true }
  );
  expect(operations.rename).not.toHaveBeenCalled();
});

it('preserves the original write failure when cleanup also fails', async () => {
  operations.writeFile.mockRejectedValue(new Error('write failed'));
  operations.close.mockRejectedValue(new Error('close failed'));
  operations.rm.mockRejectedValue(new Error('remove failed'));
  await expect(
    writeEvidenceAtomically('/tmp/evidence.json', '{}')
  ).rejects.toThrow('write failed');
  expect(operations.rm).toHaveBeenCalled();
});
