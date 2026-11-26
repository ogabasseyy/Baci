import { createRunnerLoopbackFixture } from './runner-process.support';

async function main() {
  const socketPath = process.env.BACI_TEST_SOCKET;
  if (!socketPath) throw Error('MISSING_FIXTURE_SOCKET');
  const service = await createRunnerLoopbackFixture(socketPath);
  process.stdout.write(`${service.origin}\n`);
  process.once('SIGTERM', () => {
    void service.close().catch(() => {
      process.exitCode = 1;
    });
  });
}
void main().catch(() => {
  process.exitCode = 1;
});
