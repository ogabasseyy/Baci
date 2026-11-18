import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({ spawn: vi.fn(), execFile: vi.fn() }));
vi.mock('node:child_process', () => harness);

import { executeDocker } from './docker-executor';

function fakeChild() {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
}
const invocation = {
  args: ['run'],
  env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', TZ: 'UTC' },
  timeoutMs: 20,
  maxOutputBytes: 20,
  name: 'baci-experience-test',
  input: '{}',
};
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe('local Docker process boundary', () => {
  it('kills the named candidate on timeout without forwarding provider environment', async () => {
    vi.useFakeTimers();
    vi.stubEnv('BACI_TEST_PROVIDER_SENTINEL', 'secret');
    const child = fakeChild();
    harness.spawn.mockReturnValue(child);
    harness.execFile.mockImplementation((_bin, _args, _opts, cb) => cb());
    const promise = executeDocker(invocation);
    const rejected = expect(promise).rejects.toThrow('wall-clock');
    await vi.advanceTimersByTimeAsync(25);
    await rejected;
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(harness.execFile.mock.calls[0][1]).toEqual([
      '--context',
      'colima',
      'rm',
      '-f',
      'baci-experience-test',
    ]);
    expect(harness.spawn.mock.calls[0][2].env).not.toHaveProperty(
      'BACI_TEST_PROVIDER_SENTINEL'
    );
  });
  it('rejects an excessive stream and preserves the fixed local context', async () => {
    const child = fakeChild();
    harness.spawn.mockReturnValue(child);
    harness.execFile.mockImplementation((_bin, _args, _opts, cb) => cb());
    const promise = executeDocker(invocation);
    const rejected = expect(promise).rejects.toThrow('Output budget');
    child.stdout.emit('data', Buffer.alloc(21));
    await rejected;
    expect(harness.spawn.mock.calls[0][1].slice(0, 2)).toEqual([
      '--context',
      'colima',
    ]);
  });
});
