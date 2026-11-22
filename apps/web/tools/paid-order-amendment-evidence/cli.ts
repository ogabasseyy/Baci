import { open } from 'node:fs/promises';
import { importTenderManifest, tenderManifestLimit } from './import-tenders';

async function readBounded(path: string, limit: number) {
  const handle = await open(path, 'r');
  try {
    const bytes = Buffer.alloc(limit + 1);
    let count = 0;
    while (count < bytes.length) {
      const { bytesRead } = await handle.read(
        bytes,
        count,
        bytes.length - count,
        count
      );
      if (bytesRead === 0) return bytes.subarray(0, count);
      count += bytesRead;
    }
    throw new Error('An import input exceeds its size limit.');
  } finally {
    await handle.close();
  }
}

async function main() {
  const [manifestPath, signaturePath, registryPath, extra] =
    process.argv.slice(2);
  const url = process.env.BACI_TENDER_IMPORT_URL;
  const serviceKey = process.env.BACI_TENDER_IMPORT_SERVICE_KEY;
  if (
    !manifestPath ||
    !signaturePath ||
    !registryPath ||
    extra ||
    !url ||
    !serviceKey
  ) {
    throw new Error(
      'Supply a manifest, detached signature, trust registry, and import environment.'
    );
  }
  const [bytes, signature, registry] = await Promise.all([
    readBounded(manifestPath, tenderManifestLimit),
    readBounded(signaturePath, 128),
    readBounded(registryPath, 128 * 1024),
  ]);
  const evidence = await importTenderManifest({
    bytes,
    signature: signature.toString('ascii').trim(),
    registry: JSON.parse(registry.toString('utf8')),
    url,
    serviceKey,
  });
  console.log(
    JSON.stringify({
      registeredReceipts: evidence.length,
      evidenceIds: evidence,
    })
  );
}

main().catch((error: unknown) => {
  // Files and validation errors can contain finance data. Keep them out of logs.
  const status =
    error instanceof Error
      ? /^Receipt import failed \(HTTP (\d{3})\)\.$/.exec(error.message)
      : null;
  console.error(
    status
      ? `Tender import rejected (HTTP ${status[1]}).`
      : 'Tender import stopped. Check the inputs, signer scope, and database connection.'
  );
  process.exitCode = 1;
});
