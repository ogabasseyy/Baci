import { execFile } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tenderManifestLimit } from './import-tenders';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('./cli.ts', import.meta.url));
const merchantId = '6d231035-1ba8-43f2-83f6-6cf9b7dec5a1';
const orderId = '008a82ce-d483-4ce2-b49a-a4b1100a60fc';
const evidenceId = 'f40de820-5316-4d9e-9d6f-64306e9234bf';
const serviceKey = 'synthetic-import-service-key';
const sourceId = 'finance-test';
const genericError =
  'Tender import stopped. Check the inputs, signer scope, and database connection.\n';

let directory: string;
let paths: [string, string, string];

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'baci-tender-cli-'));
  paths = [
    join(directory, 'manifest.json'),
    join(directory, 'signature.b64'),
    join(directory, 'registry.json'),
  ];
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function run(
  args: string[] = paths,
  url = 'https://synthetic.example.invalid',
  key = serviceKey
) {
  return exec(process.execPath, ['--import', 'tsx', cli, ...args], {
    env: {
      PATH: process.env.PATH,
      BACI_TENDER_IMPORT_URL: url,
      BACI_TENDER_IMPORT_SERVICE_KEY: key,
    },
    timeout: 10_000,
  });
}

async function signFixture(targetOrigin: string) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const now = new Date().toISOString();
  const bytes = Buffer.from(
    JSON.stringify({
      version: 1,
      targetOrigin,
      merchantId,
      sourceId,
      issuedAt: now,
      receipts: [
        {
          orderId,
          method: 'pos',
          status: 'settled_pos',
          amountMinor: 2_000_000,
          receiptReference: 'TERMINAL-123456',
          reconciliationReference: 'RECONCILED-123456',
          occurredAt: now,
        },
      ],
    })
  );
  await Promise.all([
    writeFile(paths[0], bytes),
    writeFile(paths[1], sign(null, bytes, privateKey).toString('base64')),
    writeFile(
      paths[2],
      JSON.stringify([
        {
          id: sourceId,
          targetOrigin,
          merchantId,
          methods: ['pos'],
          publicKeyPem: publicKey.export({ format: 'pem', type: 'spki' }),
        },
      ])
    ),
  ]);
}

async function withRpc(
  status: number,
  body: unknown,
  verify: (origin: string, received: ReturnType<typeof vi.fn>) => Promise<void>
) {
  const received = vi.fn();
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received(
      request.url,
      request.headers.authorization,
      JSON.parse(Buffer.concat(chunks).toString())
    );
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(body));
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing test server port');
    await verify(`http://127.0.0.1:${address.port}`, received);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('tender import CLI', () => {
  it('registers a signed manifest and prints only the evidence receipt', async () => {
    await withRpc(200, [evidenceId], async (origin, received) => {
      await signFixture(origin);
      const result = await run(paths, origin);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toEqual({
        registeredReceipts: 1,
        evidenceIds: [evidenceId],
      });
      expect(received).toHaveBeenCalledExactlyOnceWith(
        '/rest/v1/rpc/import_paid_order_tender_receipts',
        `Bearer ${serviceKey}`,
        expect.objectContaining({
          p_merchant_id: merchantId,
          p_source_id: sourceId,
          p_receipts: [
            expect.objectContaining({
              orderId,
              method: 'pos',
              amountMinor: 2_000_000,
            }),
          ],
        })
      );
    });
  });

  it('redacts the provider error body and exits unsuccessfully', async () => {
    await withRpc(
      409,
      { message: 'confidential finance evidence and reference' },
      async (origin, received) => {
        await signFixture(origin);
        await expect(run(paths, origin)).rejects.toMatchObject({
          code: 1,
          stdout: '',
          stderr: 'Tender import rejected (HTTP 409).\n',
        });
        expect(received).toHaveBeenCalledOnce();
      }
    );
  });

  it('rejects missing environment or incorrect argument counts', async () => {
    await Promise.all(
      [run([]), run([...paths, 'extra']), run(paths, '', '')].map((command) =>
        expect(command).rejects.toMatchObject({
          code: 1,
          stdout: '',
          stderr: genericError,
        })
      )
    );
  });

  it.each([
    [0, tenderManifestLimit],
    [1, 128],
    [2, 128 * 1024],
  ])('rejects an oversized input file at position %s before reaching the RPC', async (index, limit) => {
    await withRpc(200, [evidenceId], async (origin, received) => {
      await signFixture(origin);
      await writeFile(paths[index], Buffer.alloc(limit + 1, 'x'));
      await expect(run(paths, origin)).rejects.toMatchObject({
        code: 1,
        stdout: '',
        stderr: genericError,
      });
      expect(received).not.toHaveBeenCalled();
    });
  });
});
