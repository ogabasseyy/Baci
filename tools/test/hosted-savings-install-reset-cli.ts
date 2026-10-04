import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { createHostedSavingsDocker } from './hosted-savings-install-docker';
import { hostedSavingsInstallDiagnostic } from './hosted-savings-install-diagnostic';
import { parseHostedSavingsResetReview } from './hosted-savings-install-reset-contract';
import { verifyHostedSavingsResetFile } from './hosted-savings-install-reset-files';
import { buildHostedSavingsResetSql } from './hosted-savings-install-reset-sql';

async function main() {
  const [mode, reviewFlag, reviewFile, baselineFlag, baselineFile, ...extra] = process.argv.slice(2);
  if (!['--render-rollback','--dry-run','--apply-reviewed'].includes(mode ?? '') || reviewFlag !== '--review' || baselineFlag !== '--baseline' || !reviewFile || !baselineFile || extra.length)
    throw new Error('Invalid recovery arguments');
  const review = parseHostedSavingsResetReview(JSON.parse(await readFile(reviewFile, 'utf8')));
  await verifyHostedSavingsResetFile(review.databaseArchive);
  await verifyHostedSavingsResetFile(review.globalsArchive);
  const sql = buildHostedSavingsResetSql(await readFile(baselineFile, 'utf8'), review.publicComment, mode === '--apply-reviewed');
  if (mode === '--render-rollback') { process.stdout.write(sql); return; }
  const receipt = review.currentReceipt;
  const runtime = createHostedSavingsDocker(receipt);
  await runtime.verify();
  const docker = async (args: string[]) => {
    const { stdout } = await promisify(execFile)('docker', ['--host', `unix://${receipt.dockerSocket}`, ...args], {
      env: {PATH: process.env.PATH,HOME: process.env.HOME}, timeout: 10000, maxBuffer: 65536,
    });
    return JSON.parse(stdout);
  };
  const daemonId = await docker(['info','--format','{{json .ID}}']);
  const mounts = await docker(['inspect',receipt.containerId,'--format','{{json .Mounts}}']);
  if (!Array.isArray(mounts) || typeof daemonId !== 'string') throw new Error('Volume identity unavailable');
  const normalized = mounts.map((mount: {Type:string;Name?:string;Source:string;Destination:string;RW:boolean}) => ({Type:mount.Type,Name:mount.Name ?? null,Source:mount.Source,Destination:mount.Destination,RW:mount.RW})).sort((left,right)=>left.Destination.localeCompare(right.Destination));
  const volumeIdentitySha256 = createHash('sha256').update(JSON.stringify({daemonId,mounts:normalized})).digest('hex');
  if (volumeIdentitySha256 !== review.volumeIdentitySha256) throw new Error('Current volume identity mismatch');
  await runtime.verify();
  const output = await runtime.sql(sql);
  const rows = output.split('\n').filter(Boolean).map((line:string)=>JSON.parse(line));
  const status = mode === '--apply-reviewed' ? 'reset-committed' : 'reset-rehearsed-rolled-back';
  if (rows.length !== 2 || rows[0].preserved !== true || !/^[a-f0-9]{64}$/.test(rows[0].currentManagedSha256) || rows[1].status !== status)
    throw new Error('Recovery result indeterminate; no retry');
  process.stdout.write(`${JSON.stringify({status,currentManagedSha256:rows[0].currentManagedSha256,containerId:receipt.containerId,manifestSha256:receipt.manifestSha256,resumeAllowed:false})}\n`);
}
void main().catch((error) => {
  const diagnostic = hostedSavingsInstallDiagnostic(error instanceof Error ? error.message : '');
  process.stderr.write(`${JSON.stringify({status:'recovery-failed-or-indeterminate',...diagnostic,retryAllowed:false,outputRedacted:true})}\n`);
  process.exitCode = 1;
});
