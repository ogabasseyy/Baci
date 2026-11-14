import { startRunnerLoopback } from './runner-loopback';
import { createRunnerSocket } from './runner-socket';
import { createRunnerHandler } from './runner-transport';

/** Synthetic-only subprocess fixture; never starts an OCI runtime. */
export async function createRunnerLoopbackFixture(socketPath: string) {
  const handler = createRunnerHandler({
    key: Buffer.alloc(32, 7),
    toolchainDigest: 'a'.repeat(64),
    execute: async (_kind, payload) => ({
      output: { payload },
      wallMs: 1,
      jobId: 'synthetic',
    }),
  });
  const socket = await createRunnerSocket({ socketPath, handler });
  try {
    const loopback = await startRunnerLoopback({ socketPath, port: 0 });
    return {
      origin: loopback.origin,
      async close() {
        try {
          await loopback.close();
        } finally {
          await socket.close();
        }
      },
    };
  } catch (error) {
    await socket.close();
    throw error;
  }
}
