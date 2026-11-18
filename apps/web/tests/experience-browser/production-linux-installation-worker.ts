/** Trusted qualification driver only. Merchant compile stays inside fixed gVisor jobs. */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { verifyCompiledCandidate } from '../../src/lib/experience/compiled-candidate';
import { experienceRunnerInstallationPin } from '../../src/schemas/experience-runner-installation';
import {
  fileDigest,
  inventoryInstallationTree,
} from '../../tools/experience-runner/installation-inventory';
import { createPinnedLinuxInstallationVerifier } from '../../tools/experience-runner/installation-verifier';
import { createLinuxRunner } from '../../tools/experience-runner/linux-runner';
import { packPrivateBuild } from '../../tools/experience-runner/private-build-payload';
import { createRunnerExecutor } from '../../tools/experience-runner/runner-transport';

const input = JSON.parse(readFileSync(0, 'utf8')) as {
  mode: 'inspect' | 'verify';
  toolchainDigest: string;
  pin?: unknown;
};
const root = '/var/tmp/baci-experience-checkpoint-a';
if (input.mode === 'inspect') {
  const node24 = await inventoryInstallationTree(`${root}/node24/rootfs`);
  const browser = await inventoryInstallationTree(`${root}/browser/rootfs`);
  const version = (program: string, args = ['--version']) =>
    execFileSync(program, args, {
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 4096,
    }).trim();
  const pin = experienceRunnerInstallationPin.parse({
    format: 'baci.runner-installation-pin/v1',
    toolchainDigest: input.toolchainDigest,
    rootfs: { node24: node24.digest, browser: browser.digest },
    runscDigest: await fileDigest('/usr/local/bin/runsc'),
    versions: {
      compilerNode: version('/usr/sbin/chroot', [
        `${root}/node24/rootfs`,
        '/usr/local/bin/node',
        '--version',
      ]),
      captureNode: version('/usr/sbin/chroot', [
        `${root}/browser/rootfs`,
        '/usr/local/bin/node',
        '--version',
      ]),
      runsc: version('/usr/local/bin/runsc')
        .split('\n')[0]
        .replace('runsc version ', ''),
    },
  });
  console.log(
    JSON.stringify({
      pin,
      inventory: { node24, browser },
      scope:
        'local disposable runner observation; not production image provenance',
    })
  );
} else if (input.mode === 'verify') {
  const pin = experienceRunnerInstallationPin.parse(input.pin);
  const key = randomBytes(32);
  const verify = createPinnedLinuxInstallationVerifier(pin);
  let receipt: Awaited<ReturnType<typeof verify>> | undefined;
  const handler = await createLinuxRunner({
    key,
    toolchainDigest: input.toolchainDigest,
    verifyInstallation: async () => {
      receipt = await verify();
      return receipt;
    },
  });
  const execute = createRunnerExecutor({
    endpoint: 'https://runner.synthetic.test/v1/execute',
    key,
    toolchainDigest: input.toolchainDigest,
    fetch: (url, init) => handler(new Request(url, init)),
  });
  const hostOrigin = 'https://shop.synthetic.test';
  const job = await execute(
    'compile',
    packPrivateBuild(
      {
        format: 'baci.experience/v2',
        runtime: 'react-browser-sandbox/v1',
        sdkVersion: 'commerce-bridge/v1',
        entry: 'app.tsx',
        files: [
          {
            path: 'app.tsx',
            content:
              'export default function Store(){return <main><h1>Synthetic native Linux runner</h1></main>}',
          },
        ],
        packages: [],
        assets: [],
        routes: [{ path: '/', view: 'home' }],
        capabilities: [],
      },
      hostOrigin,
      'production'
    )
  );
  const compiled = verifyCompiledCandidate(job.output);
  console.log(
    JSON.stringify({
      installation: receipt,
      nativeLinuxRunner: true,
      jobId: job.jobId,
      buildDigest: compiled.digest,
      hostOrigin: compiled.hostOrigin,
      network: 'none',
      ordersCreated: 0,
      published: false,
    })
  );
} else throw Error('INVALID_QUALIFICATION_MODE');
