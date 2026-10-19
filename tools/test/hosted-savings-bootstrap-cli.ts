import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { hostedSavingsBootstrap } from './hosted-savings-bootstrap';
import { assertHostedSavingsCapacity } from './hosted-savings-bootstrap-capacity';
import { assertHostedSavingsDocker } from './hosted-savings-bootstrap-docker';

const args = process.argv.slice(2);
const root = fileURLToPath(new URL('../../', import.meta.url));

async function main() {
  if (args.length === 1 && args[0] === '--fresh-disposable-local') {
    await assertHostedSavingsCapacity(root);
    const endpoint = await assertHostedSavingsDocker(
      execFileSync(
        'docker',
        ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'],
        {
          encoding: 'utf8',
          timeout: 5000,
        }
      ).trim()
    );
    const environment: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      LANG: 'C.UTF-8',
      DOCKER_HOST: endpoint,
    };
    const child = spawn(
      process.execPath,
      [
        '--import',
        createRequire(import.meta.url).resolve('tsx'),
        fileURLToPath(
          new URL('./hosted-savings-bootstrap-worker.ts', import.meta.url)
        ),
      ],
      { cwd: root, env: environment, stdio: 'inherit', shell: false }
    );
    child.on('error', () => {
      process.exitCode = 1;
    });
    child.on('exit', (code) => {
      process.exitCode = code ?? 1;
    });
    return;
  }
  process.stdout.write(
    `${JSON.stringify(await hostedSavingsBootstrap(args, root))}\n`
  );
}

void main().catch((error: unknown) => {
  if (
    error instanceof Error &&
    error.message ===
      'Local replay requires at least 20 GiB free; no resources started'
  ) {
    process.stderr.write(`${error.message}\n`);
  }
  if (
    error instanceof Error &&
    error.message ===
      'Current top-level migration registry differs from the explicit pending-repair state'
  ) {
    process.stderr.write(`${error.message}\n`);
  }
  process.stderr.write(
    'Bootstrap rejected or failed; use --plan or --fresh-disposable-local.\n'
  );
  process.exitCode = 1;
});
