import { verifyProtectedInstallation } from './privileged-preflight';

async function main() {
  if (
    process.platform !== 'linux' ||
    !process.geteuid ||
    process.geteuid() !== 0
  )
    throw Error('INVALID_PREFLIGHT_IDENTITY');
  const result = await verifyProtectedInstallation();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
void main().catch(() => {
  process.stderr.write('Runner preflight failed.\n');
  process.exitCode = 1;
});
