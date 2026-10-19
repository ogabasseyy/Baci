import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { installHostedSavings } from './hosted-savings-install';
import { readHostedSavingsInstallBundle } from './hosted-savings-install-bundle';
import { hostedSavingsInstallContract } from './hosted-savings-install-contract';
import { createHostedSavingsDocker } from './hosted-savings-install-docker';

async function main() {
  const [mode, receiptFlag, receiptFile, bundleFlag, directory, ...extra] =
    process.argv.slice(2);
  if (
    !['--preflight', '--install-reviewed'].includes(mode ?? '') ||
    receiptFlag !== '--receipt' ||
    bundleFlag !== '--bundle' ||
    !receiptFile ||
    !directory ||
    extra.length
  )
    throw new Error('Invalid arguments');
  const receipt = hostedSavingsInstallContract.parse(
    JSON.parse(await readFile(receiptFile, 'utf8'))
  );
  const bundle = await readHostedSavingsInstallBundle(
    directory,
    receipt.manifestSha256
  );
  const output = await mkdtemp('/tmp/hosted-savings-install-');
  const result = await installHostedSavings(
    bundle,
    createHostedSavingsDocker(receipt),
    mode === '--install-reviewed',
    receipt.allowedNewMemberships
  );
  const report = {
    ...result,
    containerId: receipt.containerId,
    imageId: receipt.imageId,
  };
  await writeFile(
    path.join(output, 'receipt.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    { flag: 'wx', mode: 0o600 }
  );
  process.stdout.write(
    `${JSON.stringify({ ...report, evidence: path.join(output, 'receipt.json') })}\n`
  );
  if (result.status === 'failed') process.exitCode = 1;
}
void main().catch(() => {
  process.stderr.write(
    'Installer failed closed; inspect any retained receipt and journal before retry. No automatic cleanup or resume is performed.\n'
  );
  process.exitCode = 1;
});
