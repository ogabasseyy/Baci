// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { createBuilderMcpNodeServer } from './node';

vi.mock('./node', () => ({ createBuilderMcpNodeServer: vi.fn() }));
const originalArgv = [...process.argv];
afterEach(() => {
  process.argv = originalArgv;
  vi.restoreAllMocks();
  vi.resetModules();
  vi.clearAllMocks();
});
it('rejects an invalid port before creating a listener', async () => {
  process.argv = ['node', 'serve', '0'];
  await expect(import('./serve')).rejects.toThrow('Invalid listener port');
  expect(createBuilderMcpNodeServer).not.toHaveBeenCalled();
});
it('binds loopback and closes once when both shutdown signals arrive', async () => {
  process.argv = ['node', 'serve', '8791'];
  const close = vi.fn().mockResolvedValue(undefined);
  const listen = vi.fn();
  vi.mocked(createBuilderMcpNodeServer).mockReturnValue({
    server: { listen },
    close,
  } as unknown as ReturnType<typeof createBuilderMcpNodeServer>);
  const once = vi.spyOn(process, 'once').mockReturnValue(process);
  await import('./serve');
  expect(listen).toHaveBeenCalledWith(8791, '127.0.0.1');
  for (const [signal, listener] of once.mock.calls)
    if (signal === 'SIGTERM' || signal === 'SIGINT') listener();
  expect(close).toHaveBeenCalledTimes(1);
});
