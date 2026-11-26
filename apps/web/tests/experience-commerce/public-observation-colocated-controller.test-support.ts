import { execFile, spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { promisify } from 'node:util';
import {
  PREPARE,
  REMOVE_BUNDLE,
  ROOT,
} from '../../tools/experience-runner/local-oci-executor';
import { makeOCISpec } from '../../tools/experience-runner/oci-policy';
import { runPublicObservationJob } from '../../tools/experience-runner/public-observation-executor';
import {
  cartId,
  fixture,
  merchantId,
  origin,
  productId,
} from '../../tools/experience-runner/public-observation-fixture.test-support';
import { createPublicCartPolicy } from '../../tools/experience-verifier/public-cart-policy';

const exec = promisify(execFile);
async function main() {
  const worker = process.argv[2];
  const helper = process.argv[3];
  if (
    !/^\/var\/tmp\/baci-observer-test-[a-f0-9-]{36}\/worker\.mjs$/.test(
      worker ?? ''
    )
  )
    throw Error('BAD_WORKER');
  if (
    helper &&
    helper !== 'sudo' &&
    helper !== worker?.replace('/worker.mjs', '/helper.py')
  )
    throw Error('BAD_HELPER');
  const workerDirectory = `${ROOT}/browser/rootfs/opt/experience`;
  const originalEntries = (await readdir(workerDirectory)).sort();
  const spec = makeOCISpec(
    `${ROOT}/browser/rootfs`,
    ['/usr/local/bin/node', '/opt/experience/capture-worker.mjs'],
    'capture'
  );
  spec.process.env.push('HOME=/tmp', 'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright');
  spec.mounts.push({
    destination: '/opt/experience/capture-worker.mjs',
    type: 'bind',
    source: worker,
    options: ['bind', 'ro', 'nosuid', 'nodev'],
  });
  const command = async (_program: string, args: string[]) => {
    if (
      helper &&
      ((args[2] === 'prepare' && args[3] === 'public-observe') ||
        args[2] === 'delete')
    ) {
      if (helper === 'sudo')
        await exec(
          '/usr/bin/sudo',
          ['-n', '/usr/local/libexec/baci-experience-helper', ...args.slice(2)],
          { timeout: 15000 }
        );
      else
        await exec('/usr/bin/python3', ['-I', helper, ...args.slice(2)], {
          timeout: 15000,
        });
      return '';
    }
    if (args[2] === 'prepare' && args[3] === 'public-observe') {
      const job = exec('python3', ['-c', PREPARE], { timeout: 15000 });
      job.child.stdin?.end(JSON.stringify({ name: args[4], spec }));
      await job;
      return '';
    }
    if (args[2] === 'delete') {
      await exec(
        '/usr/local/bin/runsc',
        [`--root=${ROOT}/state`, 'delete', '--force', args[3]],
        { timeout: 15000 }
      );
      await exec('python3', ['-c', REMOVE_BUNDLE, args[3]], { timeout: 15000 });
      return '';
    }
    throw Error('BAD_COMMAND');
  };
  const start = (name: string) =>
    helper === 'sudo'
      ? spawn(
          '/usr/bin/sudo',
          ['-n', '/usr/local/libexec/baci-experience-helper', 'run', name],
          { stdio: 'pipe' }
        )
      : helper
        ? spawn('/usr/bin/python3', ['-I', helper, 'run', name], {
            stdio: 'pipe',
          })
        : spawn(
            '/usr/local/bin/runsc',
            [
              `--root=${ROOT}/state`,
              '--network=none',
              'run',
              `--bundle=${ROOT}/jobs/${name}`,
              name,
            ],
            { stdio: 'pipe' }
          );
  const policy = createPublicCartPolicy({
    origin,
    merchantSlug: 'synthetic',
    productId,
  });
  const cart = {
    cartId,
    merchantId,
    version: 1,
    lines: [{ item: { productId }, quantity: 1 }],
  };
  const checkout = {
    cartId,
    merchantId,
    cartVersion: 1,
    checkoutSessionId: '55555555-5555-4555-8555-555555555555',
    lines: [{ productId, variantId: null, quantity: 1, available: true }],
  };
  const requests: string[] = [];
  const started = performance.now();
  const result = await runPublicObservationJob(
    {
      payload: fixture({ dynamicChunk: true }),
      session: (request) => {
        requests.push(
          `${Math.round(performance.now() - started)}ms ${request.method} ${new URL(request.url).pathname}`
        );
        if (
          request.url === `${origin}/_next/static/chunks/lazy.js` &&
          request.method === 'GET'
        )
          return Promise.resolve({
            status: 200,
            body: JSON.stringify({
              mime: 'text/javascript',
              bytes: Buffer.from('window.syntheticChunk = 42').toString(
                'base64'
              ),
            }),
          });
        if (!policy(request)) throw Error('DENIED');
        return Promise.resolve({
          status: 200,
          body: request.url.endsWith('/api/csrf')
            ? '{}'
            : JSON.stringify(
                request.url.endsWith('/checkout')
                  ? { snapshot: checkout }
                  : { cart }
              ),
        });
      },
    },
    { command, start }
  );
  const journey = result.output.journey as {
    orderRequests: number;
    paymentRequests: number;
    steps: { action: string }[];
  };
  if (
    JSON.stringify((await readdir(workerDirectory)).sort()) !==
    JSON.stringify(originalEntries)
  )
    throw Error('BROWSER_ROOTFS_CHANGED');
  if (
    journey.orderRequests !== 0 ||
    journey.paymentRequests !== 0 ||
    journey.steps.map((step) => step.action).join(',') !==
      'navigate,product,cart-add,cart-read,checkout-review' ||
    !requests.some((request) =>
      request.endsWith('/_next/static/chunks/lazy.js')
    )
  )
    throw Error('BAD_EVIDENCE');
  process.stdout.write(
    `${JSON.stringify({ wallMs: result.wallMs, requests })}\n`
  );
}
main().catch(() => {
  process.stderr.write('COLOCATED_TEST_FAILED\n');
  process.exitCode = 1;
});
