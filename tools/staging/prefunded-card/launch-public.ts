import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { createFirstCardLaunchEnvironment } from '../../../apps/web/src/lib/piggyvest/first-card-launch-environment';
import { verifyFirstCardLaunchReadiness } from '../../../apps/web/src/lib/piggyvest/first-card-launch-readiness';

function readConfiguration(path: string, limit: number): unknown {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = fstatSync(descriptor);
    if (
      !metadata.isFile() ||
      metadata.nlink !== 1 ||
      metadata.size > limit ||
      metadata.size === 0 ||
      (metadata.mode & 0o022) !== 0
    )
      throw new Error();
    return JSON.parse(readFileSync(descriptor, 'utf8'));
  } finally {
    closeSync(descriptor);
  }
}

async function main() {
  const arguments_ = process.argv.slice(2);
  if (
    arguments_.length > 1 ||
    (arguments_.length === 1 && arguments_[0] !== '--check')
  )
    throw new Error();
  const configuration = readConfiguration(
    '/run/pvb-public/checkout.json',
    65_536
  );
  const environment = createFirstCardLaunchEnvironment(
    configuration,
    readConfiguration('/run/pvb-public/anon.json', 16_384),
    Date.now(),
    process.env.PREFUNDED_CARD_CHECKOUT_MUTATIONS_ENABLED === 'true'
  );
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, environment);
  if (arguments_[0] === '--check') {
    const result = await verifyFirstCardLaunchReadiness(configuration);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  process.chdir('/app/apps/web');
  createRequire('/app/launch-public.cjs')('/app/apps/web/server.js');
}

main().catch(() => {
  process.stderr.write(
    '{"status":"first-card-launch-refused","redacted":true}\n'
  );
  process.exitCode = 1;
});
