import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { ROOT } from '../../tools/experience-runner/local-oci-executor';

const exec = promisify(execFile);
export async function stageRemoteHelper(input: {
  remoteDir: string;
  workerSource: string;
  ssh(script: string): ReturnType<typeof exec>;
}) {
  const helperFile = process.env.BACI_OBSERVER_HELPER_FILE;
  if (!helperFile?.startsWith('/')) throw Error('INVALID_HELPER_FILE');
  const helperBytes = readFileSync(helperFile);
  const helperHash = createHash('sha256').update(helperBytes).digest('hex');
  if (helperHash !== process.env.BACI_OBSERVER_HELPER_SHA256)
    throw Error('REMOTE_HELPER_CANDIDATE_MISMATCH');
  const helperUpload = input.ssh(
    `import os,sys,hashlib\np=${JSON.stringify(input.remoteDir)}+'/helper.py'\nf=os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o700)\nwith os.fdopen(f,'wb') as out: out.write(sys.stdin.buffer.read())\nprint(hashlib.sha256(open(p,'rb').read()).hexdigest())`
  );
  helperUpload.child.stdin?.end(helperBytes);
  if (String((await helperUpload).stdout).trim() !== helperHash)
    throw Error('REMOTE_HELPER_DIGEST_MISMATCH');
  await input.ssh(
    `import os,hashlib\ns=${JSON.stringify(input.workerSource)}\nd=${JSON.stringify(`${ROOT}/browser/rootfs/opt/experience/public-observation-worker.mjs`)}\nb=open(s,'rb').read()\nassert hashlib.sha256(b).hexdigest()==${JSON.stringify(process.env.BACI_OBSERVER_WORKER_SHA256)}\nf=os.open(d,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o644)\nwith os.fdopen(f,'wb') as out: out.write(b)`
  );
}
export async function runColocatedObserver(input: {
  directory: string;
  remoteDir: string;
  workerSource: string;
  helperMode: boolean | undefined;
  sudoMode: boolean | undefined;
  trialUser: string;
  sshArgs: string[];
  ssh(script: string): ReturnType<typeof exec>;
}) {
  const controller = join(input.directory, 'controller.mjs');
  await build({
    entryPoints: [
      'tests/experience-commerce/public-observation-colocated.fixture.ts',
    ],
    outfile: controller,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  const upload = input.ssh(
    `import os,sys\np=${JSON.stringify(input.remoteDir)}+'/controller.mjs'\nf=os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o644)\nwith os.fdopen(f,'wb') as out: out.write(sys.stdin.buffer.read())`
  );
  upload.child.stdin?.end(readFileSync(controller));
  await upload;
  const run = await exec(
    'ssh',
    [
      ...input.sshArgs,
      `${input.sudoMode ? `/usr/bin/sudo -n -u ${input.trialUser} ` : ''}${ROOT}/node24/rootfs/usr/local/bin/node ${input.remoteDir}/controller.mjs ${input.workerSource}${input.helperMode ? (input.sudoMode ? ' sudo' : ` ${input.remoteDir}/helper.py`) : ''}`,
    ],
    { timeout: 110000 }
  );
  return JSON.parse(run.stdout) as { wallMs: number; requests: string[] };
}
