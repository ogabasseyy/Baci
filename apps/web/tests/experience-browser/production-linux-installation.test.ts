import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { expect, it as qualificationTest } from 'vitest';

// Explicit opt-in: requires the separately provisioned local Colima/gVisor fixture.
const it = qualificationTest.skipIf(
  process.env.BACI_LOCAL_EXPERIENCE_QUALIFICATION !== '1'
);

const exec = promisify(execFile);
it('pins the existing local Linux installation and executes the native runner with verified bytes', async () => {
  const directory = resolve(
    '../../.superpowers/sdd/2026-11-03-runner-qualification'
  );
  mkdirSync(directory, { recursive: true });
  const worker = resolve(directory, 'qualification-worker.mjs');
  await build({
    entryPoints: [
      resolve(
        'tests/experience-browser/production-linux-installation-worker.ts'
      ),
    ],
    outfile: worker,
    platform: 'node',
    format: 'esm',
    bundle: true,
    logLevel: 'silent',
  });
  const root = '/var/tmp/baci-experience-checkpoint-a';
  const target = `${root}/qualification-worker.mjs`;
  await exec('colima', ['ssh', '--', 'sudo', 'cp', worker, target], {
    timeout: 10000,
  });
  const invoke = async (input: unknown) => {
    const child = exec(
      'colima',
      ['ssh', '--', 'sudo', `${root}/node24/rootfs/usr/local/bin/node`, target],
      { timeout: 180000, maxBuffer: 1024 * 1024 }
    );
    child.child.stdin?.on('error', () => undefined);
    child.child.stdin?.end(JSON.stringify(input));
    return JSON.parse((await child).stdout);
  };
  const toolchain = JSON.parse(
    readFileSync(
      resolve(
        '../../.superpowers/sdd/2026-10-23-full-code-experiences/checkpoint-b-toolchain.json'
      ),
      'utf8'
    )
  );
  const inspection = await invoke({
    mode: 'inspect',
    toolchainDigest: toolchain.digest,
  });
  const proof = await invoke({
    mode: 'verify',
    pin: inspection.pin,
    toolchainDigest: toolchain.digest,
  });
  const evidence = resolve(
    '../../docs/connectors/evidence/experience-runner-delivery-rc-20261103'
  );
  mkdirSync(evidence, { recursive: true });
  writeFileSync(
    resolve(evidence, 'local-installation-pin.json'),
    `${JSON.stringify(inspection, null, 2)}\n`
  );
  writeFileSync(
    resolve(evidence, 'native-linux-proof.json'),
    `${JSON.stringify(proof, null, 2)}\n`
  );
  expect(proof.nativeLinuxRunner).toBe(true);
  expect(proof.installation.toolchainDigest).toBe(toolchain.digest);
  expect(proof.hostOrigin).toBe('https://shop.synthetic.test');
  expect(proof.installation.rootfs.node24.digest).toBe(
    inspection.pin.rootfs.node24
  );
  expect(proof.installation.rootfs.browser.digest).toBe(
    inspection.pin.rootfs.browser
  );
  expect(proof.ordersCreated).toBe(0);
}, 360000);
