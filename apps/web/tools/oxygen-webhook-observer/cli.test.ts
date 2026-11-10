// @vitest-environment node
import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  append: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn(),
  on: vi.fn(),
  create: vi.fn(),
}));
vi.mock('node:fs/promises', () => ({
  mkdir: mocks.mkdir,
  appendFile: mocks.append,
}));
vi.mock('node:http', () => ({ createServer: mocks.create }));
it('opens only a loopback listener with a private observation directory', async () => {
  mocks.create.mockReturnValue({ listen: mocks.listen, on: mocks.on });
  await import('./cli');
  expect(mocks.mkdir).toHaveBeenCalledWith(
    expect.stringContaining('webhook-observer'),
    { recursive: true, mode: 0o700 }
  );
  expect(mocks.create).toHaveBeenCalledOnce();
  expect(mocks.listen).toHaveBeenCalledWith(
    3430,
    '127.0.0.1',
    expect.any(Function)
  );
  expect(mocks.on).toHaveBeenCalledWith('error', expect.any(Function));
  expect(mocks.append).not.toHaveBeenCalled();
});
