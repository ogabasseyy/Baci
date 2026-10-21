import { fork } from 'node:child_process';
export function startChild(module, args, env = {}) {
  const child = fork(module, args, {
    env,
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Fixture child readiness timeout'));
    }, 5000);
    const done = (callback, value) => {
      clearTimeout(timer);
      callback(value);
    };
    child.once('message', (value) => done(resolve, value));
    child.once('error', () => done(reject, new Error('Fixture child failed')));
    child.once('exit', () =>
      done(reject, new Error('Fixture child exited before ready'))
    );
  });
  return { child, ready };
}
export async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    child.once('exit', resolve);
    child.kill();
  });
}
export function onTermination(cleanup) {
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.once(signal, () => {
      void cleanup().finally(() => process.exit(143));
    });
}
