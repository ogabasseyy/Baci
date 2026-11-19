import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock('node:child_process', () => ({
  execFile: Object.assign(() => {}, {
    [Symbol.for('nodejs.util.promisify.custom')]: mocked.exec,
  }),
}));

import { runLocalQualification } from './local-oci-executor';

it('handles a broken child stdin while retaining the execution error and scoped cleanup', async () => {
  const original = Error('local runner exited');
  const calls: string[][] = [];
  const streams: EventEmitter[] = [];
  mocked.exec.mockImplementation((_command: string, args: string[]) => {
    calls.push(args);
    const stdin = Object.assign(new EventEmitter(), {
      end: () => {
        if (args.includes('run'))
          stdin.emit(
            'error',
            Object.assign(Error('broken pipe'), { code: 'EPIPE' })
          );
      },
    });
    streams.push(stdin);
    return Object.assign(
      args.includes('run')
        ? Promise.reject(original)
        : Promise.resolve({ stdout: '' }),
      {
        child: {
          stdin,
          stdout: new EventEmitter(),
          stderr: new EventEmitter(),
          kill: vi.fn(),
        },
      }
    );
  });
  await expect(runLocalQualification('checks', {})).rejects.toBe(original);
  expect(calls.at(-2)).toContain('delete');
  expect(calls.at(-1)).toContain('python3');
  expect(streams.every((stream) => stream.listenerCount('error') === 1)).toBe(
    true
  );
});
