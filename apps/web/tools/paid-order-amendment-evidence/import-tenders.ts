import { createPublicKey, verify } from 'node:crypto';
import { z } from 'zod';

export const tenderManifestLimit = 64 * 1024;
export const tenderManifestMaxAgeMs = 24 * 60 * 60 * 1000;
const sourceId = z.string().regex(/^[a-z0-9_-]{3,32}$/);
const method = z.enum(['cash', 'pos']);
const instant = z.iso.datetime({ offset: true });
const receiptFields = {
  orderId: z.uuid(),
  amountMinor: z.number().int().min(1).max(9_999_999_999),
  receiptReference: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]{7,99}$/),
  reconciliationReference: z.string().regex(/^[A-Za-z0-9_.:/-]{8,120}$/),
  occurredAt: instant,
};
const receiptSchema = z.discriminatedUnion('method', [
  z.strictObject({
    ...receiptFields,
    method: z.literal('cash'),
    status: z.literal('reconciled_cash'),
  }),
  z.strictObject({
    ...receiptFields,
    method: z.literal('pos'),
    status: z.literal('settled_pos'),
  }),
]);
const manifestSchema = z.strictObject({
  version: z.literal(1),
  sourceId,
  merchantId: z.uuid(),
  targetOrigin: z.string(),
  issuedAt: instant,
  receipts: z.array(receiptSchema).min(1).max(50),
});
const registrySchema = z
  .array(
    z.strictObject({
      id: sourceId,
      merchantId: z.uuid(),
      targetOrigin: z.string(),
      methods: z.array(method).min(1).max(2),
      publicKeyPem: z
        .string()
        .startsWith('-----BEGIN PUBLIC KEY-----')
        .max(1024),
    })
  )
  .min(1)
  .max(100);

interface ImportOptions {
  bytes: Buffer;
  signature: string;
  registry: unknown;
  url: string;
  serviceKey: string;
  now?: Date;
  fetchRpc?: typeof fetch;
}

function targetOrigin(value: string) {
  const url = URL.parse(value);
  if (!url) throw new Error('Invalid receipt import target origin.');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Invalid receipt import target origin.');
  }
  return url.origin;
}

export async function importTenderManifest({
  bytes,
  signature,
  registry,
  url,
  serviceKey,
  now = new Date(),
  fetchRpc = fetch,
}: ImportOptions): Promise<string[]> {
  if (bytes.length > tenderManifestLimit)
    throw new Error('Receipt manifest is too large.');
  const manifest = manifestSchema.parse(JSON.parse(bytes.toString('utf8')));
  const sources = registrySchema.parse(registry);
  const matching = sources.filter((source) => source.id === manifest.sourceId);
  if (matching.length !== 1)
    throw new Error('Receipt signer is unavailable or ambiguous.');
  const [source] = matching;
  const destination = targetOrigin(url);
  if (
    targetOrigin(manifest.targetOrigin) !== destination ||
    targetOrigin(source.targetOrigin) !== destination
  ) {
    throw new Error('Receipt target does not match the configured database.');
  }
  const key = createPublicKey(source.publicKeyPem);
  if (
    key.asymmetricKeyType !== 'ed25519' ||
    !/^[A-Za-z0-9+/]{86}==$/.test(signature) ||
    !verify(null, bytes, key, Buffer.from(signature, 'base64'))
  ) {
    throw new Error('Receipt manifest signature could not be verified.');
  }
  if (
    source.merchantId !== manifest.merchantId ||
    manifest.receipts.some(
      (receipt) => !source.methods.includes(receipt.method)
    )
  ) {
    throw new Error('Receipt evidence is outside the signer scope.');
  }
  const issued = Date.parse(manifest.issuedAt);
  const age = now.getTime() - issued;
  if (
    !Number.isFinite(age) ||
    age < 0 ||
    age > tenderManifestMaxAgeMs ||
    manifest.receipts.some((receipt) => Date.parse(receipt.occurredAt) > issued)
  ) {
    throw new Error('Receipt manifest timestamps are invalid.');
  }
  const references = manifest.receipts.map(
    (receipt) => `${receipt.method}:${receipt.receiptReference.toUpperCase()}`
  );
  if (new Set(references).size !== references.length)
    throw new Error('Receipt manifest contains a duplicate reference.');
  if (!serviceKey.trim())
    throw new Error('The tender importer service key is required.');

  const response = await fetchRpc(
    `${destination}/rest/v1/rpc/import_paid_order_tender_receipts`,
    {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: {
        apikey: serviceKey,
        ...(serviceKey.startsWith('sb_secret_')
          ? {}
          : { Authorization: `Bearer ${serviceKey}` }),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_merchant_id: manifest.merchantId,
        p_source_id: source.id,
        p_receipts: manifest.receipts.map(
          ({ status: _status, ...receipt }) => receipt
        ),
      }),
    }
  );
  if (!response.ok)
    throw new Error(`Receipt import failed (HTTP ${response.status}).`);
  const ids = z
    .array(z.uuid())
    .length(manifest.receipts.length)
    .parse(await response.json());
  if (new Set(ids).size !== ids.length)
    throw new Error('Receipt import returned duplicate evidence IDs.');
  return ids;
}
