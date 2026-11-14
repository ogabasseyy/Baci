import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { bundlePublicObservationWorker } from '../../tools/builder-production/operator-bundle';
import {
  PREPARE,
  REMOVE_BUNDLE,
  ROOT,
} from '../../tools/experience-runner/local-oci-executor';
import { makeOCISpec } from '../../tools/experience-runner/oci-policy';
import { runPublicObservationJob } from '../../tools/experience-runner/public-observation-executor';
import {
  syntheticCart as cart,
  syntheticCheckout as checkout,
  fixture,
  origin,
  productId,
} from '../../tools/experience-runner/public-observation-fixture.test-support';
import { createPublicCartPolicy } from '../../tools/experience-verifier/public-cart-policy';
import {
  runColocatedObserver,
  stageRemoteHelper,
} from './public-observation-colocated.test-support';

const exec = promisify(execFile);
it.skipIf(process.env.BACI_LOCAL_OBSERVER_SANDBOX_TEST !== '1')(
  'runs the combined observer in a network-disabled gVisor worker',
  async () => {
    const directory = mkdtempSync('/Users/mac/.codex/tmp/baci-observer-job-');
    const worker = join(directory, 'worker.mjs');
    let prepared = false;
    const remote = process.env.BACI_OBSERVER_SSH_HOST;
    const identity = process.env.BACI_OBSERVER_SSH_IDENTITY;
    if (
      remote &&
      (!/^root@[A-Za-z0-9.-]+$/.test(remote) || !identity?.startsWith('/'))
    )
      throw Error('INVALID_OBSERVER_TEST_TARGET');
    const sshArgs =
      remote && identity
        ? [
            '-i',
            identity,
            '-o',
            'BatchMode=yes',
            '-o',
            'ConnectTimeout=10',
            remote,
          ]
        : [];
    const remoteDir = `/var/tmp/baci-observer-test-${randomUUID()}`;
    let remoteCreated = false;
    const colocated =
      Boolean(remote) && process.env.BACI_OBSERVER_COLOCATED === '1';
    const helperMode =
      colocated && process.env.BACI_OBSERVER_FIXED_HELPER === '1';
    const sudoMode = helperMode && process.env.BACI_OBSERVER_SUDO_TEST === '1';
    const trialUser = `baciq${randomUUID().replaceAll('-', '').slice(0, 8)}`;
    const sudoers = `/etc/sudoers.d/${trialUser}`;
    const sudoRule = `${trialUser} ALL=(root) NOPASSWD: /usr/local/libexec/baci-experience-helper *\n`;
    let colocatedFinished = false;
    const remotePython = (script: string) =>
      `python3 -c 'exec(__import__("base64").b64decode("${Buffer.from(script).toString('base64')}"))'`;
    const ssh = (script: string, timeout = 15000) =>
      exec('ssh', [...sshArgs, remotePython(script)], { timeout });
    try {
      await bundlePublicObservationWorker(worker);
      let workerSource = worker;
      if (remote) {
        const bytes = readFileSync(worker);
        const digest = createHash('sha256').update(bytes).digest('hex');
        if (process.env.BACI_OBSERVER_WORKER_SHA256 !== digest)
          throw Error('REMOTE_OBSERVER_CANDIDATE_MISMATCH');
        const upload = ssh(
          `import os,sys,hashlib\np=${JSON.stringify(remoteDir)}\nos.mkdir(p,0o700)\nf=os.open(p+'/worker.mjs',os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o644)\nwith os.fdopen(f,'wb') as out: out.write(sys.stdin.buffer.read())\nprint(hashlib.sha256(open(p+'/worker.mjs','rb').read()).hexdigest())`
        );
        remoteCreated = true;
        upload.child.stdin?.end(bytes);
        if ((await upload).stdout.trim() !== digest)
          throw Error('REMOTE_OBSERVER_DIGEST_MISMATCH');
        workerSource = `${remoteDir}/worker.mjs`;
      }
      if (colocated) {
        if (helperMode) {
          await stageRemoteHelper({ remoteDir, workerSource, ssh });
          if (sudoMode) {
            await ssh(
              `import os,subprocess,hashlib\np=${JSON.stringify(remoteDir)}\nsrc=p+'/helper.py'\nd='/usr/local/libexec/baci-experience-helper'\nb=open(src,'rb').read()\nassert hashlib.sha256(b).hexdigest()==${JSON.stringify(process.env.BACI_OBSERVER_HELPER_SHA256)}\nf=os.open(d,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o755)\nwith os.fdopen(f,'wb') as out: out.write(b)\nos.chmod(p,0o755)\nsubprocess.run(['/usr/sbin/useradd','--system','--no-create-home','--shell','/usr/sbin/nologin',${JSON.stringify(trialUser)}],check=True)\nf=os.open(${JSON.stringify(sudoers)},os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o440)\nwith os.fdopen(f,'w') as out: out.write(${JSON.stringify(sudoRule)})\nsubprocess.run(['/usr/sbin/visudo','-c','-f',${JSON.stringify(sudoers)}],check=True,stdout=subprocess.DEVNULL)\nfor cmd in (['/usr/local/bin/runsc','--version'],['/usr/local/libexec/baci-experience-helper','invalid']):\n r=subprocess.run(['/usr/bin/sudo','-n','-u',${JSON.stringify(trialUser)},'/usr/bin/sudo','-n']+cmd,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)\n assert r.returncode != 0`
            );
          }
        }
        const timing = await runColocatedObserver({
          directory,
          remoteDir,
          workerSource,
          helperMode,
          sudoMode,
          trialUser,
          sshArgs,
          ssh,
        });
        expect(timing.wallMs).toBeGreaterThan(0);
        expect(
          timing.requests.some((request: string) =>
            request.endsWith('/api/storefront/cart/checkout')
          )
        ).toBe(true);
        colocatedFinished = true;
        process.stdout.write(
          `SYNTHETIC_COLOCATED_TIMING ${JSON.stringify(timing)}\n`
        );
        return;
      }
      const spec = makeOCISpec(
        `${ROOT}/browser/rootfs`,
        ['/usr/local/bin/node', '/opt/experience/capture-worker.mjs'],
        'capture'
      );
      spec.process.env.push(
        'HOME=/tmp',
        'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright'
      );
      spec.mounts.push({
        destination: '/opt/experience/capture-worker.mjs',
        type: 'bind',
        source: workerSource,
        options: ['bind', 'ro', 'nosuid', 'nodev'],
      });
      const command = async (_program: string, args: string[]) => {
        if (args[2] === 'prepare' && args[3] === 'public-observe') {
          const job = remote
            ? ssh(PREPARE)
            : exec('colima', ['ssh', '--', 'sudo', 'python3', '-c', PREPARE], {
                timeout: 15000,
              });
          job.child.stdin?.end(JSON.stringify({ name: args[4], spec }));
          await job;
          prepared = true;
          return '';
        }
        if (args[2] === 'delete') {
          if (remote) {
            await exec(
              'ssh',
              [
                ...sshArgs,
                `/usr/local/bin/runsc --root=${ROOT}/state delete --force ${args[3]}`,
              ],
              { timeout: 15000 }
            );
            await ssh(
              `${REMOVE_BUNDLE.replace('name=sys.argv[1]', `name=${JSON.stringify(args[3])}`)}`
            );
            prepared = false;
            return '';
          }
          await exec(
            'colima',
            [
              'ssh',
              '--',
              'sudo',
              '/usr/local/bin/runsc',
              `--root=${ROOT}/state`,
              'delete',
              '--force',
              args[3],
            ],
            { timeout: 15000 }
          );
          await exec(
            'colima',
            ['ssh', '--', 'sudo', 'python3', '-c', REMOVE_BUNDLE, args[3]],
            { timeout: 15000 }
          );
          prepared = false;
          return '';
        }
        throw Error('INVALID_TEST_HELPER_COMMAND');
      };
      let stderr = '';
      const start = (name: string) => {
        const child = remote
          ? spawn(
              'ssh',
              [
                ...sshArgs,
                `/usr/local/bin/runsc --root=${ROOT}/state --network=none run --bundle=${ROOT}/jobs/${name} ${name}`,
              ],
              { stdio: 'pipe' }
            )
          : spawn(
              'colima',
              [
                'ssh',
                '--',
                'sudo',
                '/usr/local/bin/runsc',
                `--root=${ROOT}/state`,
                '--network=none',
                'run',
                `--bundle=${ROOT}/jobs/${name}`,
                name,
              ],
              { stdio: 'pipe' }
            );
        child.stderr.on('data', (chunk: Buffer) => {
          stderr = (stderr + chunk.toString()).slice(-4096);
        });
        return child;
      };
      const policy = createPublicCartPolicy({
        origin,
        merchantSlug: 'synthetic',
        productId,
      });
      let result: Awaited<ReturnType<typeof runPublicObservationJob>>;
      let dynamicRequests = 0;
      const observedRequests: string[] = [];
      const startedAt = performance.now();
      try {
        result = await runPublicObservationJob(
          {
            payload: fixture({ dynamicChunk: true }),
            session: async (request) => {
              observedRequests.push(
                `${Math.round(performance.now() - startedAt)}ms ${request.method} ${new URL(request.url).pathname}`
              );
              if (
                request.url === `${origin}/_next/static/chunks/lazy.js` &&
                request.method === 'GET'
              ) {
                dynamicRequests++;
                return {
                  status: 200,
                  body: JSON.stringify({
                    mime: 'text/javascript',
                    bytes: Buffer.from('window.syntheticChunk = 42').toString(
                      'base64'
                    ),
                  }),
                };
              }
              if (!policy(request)) throw Error('DENIED');
              if (request.url.endsWith('/api/csrf'))
                return { status: 200, body: '{}' };
              return {
                status: 200,
                body: JSON.stringify(
                  request.url.endsWith('/checkout')
                    ? { snapshot: checkout }
                    : { cart }
                ),
              };
            },
          },
          { command, start }
        );
      } catch {
        throw Error(
          `SYNTHETIC_OBSERVER_FAILED: ${stderr}; requests=${observedRequests.join(',')}`
        );
      }
      expect(result.output).toMatchObject({
        journey: {
          orderRequests: 0,
          paymentRequests: 0,
          steps: [
            { action: 'navigate' },
            { action: 'product' },
            { action: 'cart-add' },
            { action: 'cart-read' },
            { action: 'checkout-review' },
          ],
        },
      });
      expect(dynamicRequests).toBeGreaterThan(0);
      process.stdout.write(
        `SYNTHETIC_TIMING ${JSON.stringify({ wallMs: result.wallMs, requests: observedRequests })}\n`
      );
    } finally {
      if (
        remote &&
        remoteCreated &&
        !prepared &&
        (!colocated || colocatedFinished)
      )
        await ssh(
          `import os,hashlib,subprocess\np=${JSON.stringify(remoteDir)}\n${sudoMode ? `assert open(${JSON.stringify(sudoers)}).read()==${JSON.stringify(sudoRule)}\nassert hashlib.sha256(open('/usr/local/libexec/baci-experience-helper','rb').read()).hexdigest()==${JSON.stringify(process.env.BACI_OBSERVER_HELPER_SHA256)}\nos.unlink(${JSON.stringify(sudoers)})\nsubprocess.run(['/usr/sbin/userdel',${JSON.stringify(trialUser)}],check=True)\nos.unlink('/usr/local/libexec/baci-experience-helper')\n` : ''}${helperMode ? `w=${JSON.stringify(`${ROOT}/browser/rootfs/opt/experience/public-observation-worker.mjs`)}\nassert hashlib.sha256(open(w,'rb').read()).hexdigest()==${JSON.stringify(process.env.BACI_OBSERVER_WORKER_SHA256)}\nos.unlink(w)\nos.unlink(p+'/helper.py')\n` : ''}${colocated ? "os.unlink(p+'/controller.mjs')\n" : ''}os.unlink(p+'/worker.mjs')\nos.rmdir(p)`
        );
      if (!prepared) rmSync(directory, { recursive: true, force: true });
    }
  },
  120000
);
