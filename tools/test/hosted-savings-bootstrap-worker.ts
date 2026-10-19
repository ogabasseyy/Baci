import { fileURLToPath } from 'node:url';
import { hostedSavingsBootstrap } from './hosted-savings-bootstrap';
import { assertHostedSavingsCapacity } from './hosted-savings-bootstrap-capacity';
import { assertHostedSavingsDocker } from './hosted-savings-bootstrap-docker';

if (
  process.argv.length !== 2 ||
  Object.keys(process.env).some((name) =>
    /^(PG|SUPABASE|DATABASE|DOCKER_CONTEXT|DOCKER_TLS|DOCKER_CONFIG)/.test(name)
  )
)
  throw new Error('Isolated local bootstrap worker environment required');

void assertHostedSavingsDocker(process.env.DOCKER_HOST)
  .then(() =>
    assertHostedSavingsCapacity(
      fileURLToPath(new URL('../../', import.meta.url))
    )
  )
  .then(() =>
    hostedSavingsBootstrap(
      ['--fresh-disposable-local'],
      fileURLToPath(new URL('../../', import.meta.url))
    )
  )
  .then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  })
  .catch((error: unknown) => {
    if (
      error instanceof Error &&
      /^(Local Docker (endpoint|socket) required|[a-z-]+ version mismatch)$/.test(
        error.message
      )
    ) {
      process.stderr.write(`${error.message}\n`);
    }
    process.stderr.write('Fresh local replay failed; no resume attempted.\n');
    process.exitCode = 1;
  });
