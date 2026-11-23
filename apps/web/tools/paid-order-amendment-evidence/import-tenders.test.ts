import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { importTenderManifest, tenderManifestMaxAgeMs } from './import-tenders';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const target = 'https://synthetic-supabase.example.invalid';
const merchant = '6d231035-1ba8-43f2-83f6-6cf9b7dec5a1';
const order = '008a82ce-d483-4ce2-b49a-a4b1100a60fc';
const evidence = 'f40de820-5316-4d9e-9d6f-64306e9234bf';
const now = new Date('2026-11-22T14:00:00Z');
const registry = [
  {
    id: 'finance-01',
    merchantId: merchant,
    targetOrigin: target,
    methods: ['cash', 'pos'],
    publicKeyPem: publicKey.export({ format: 'pem', type: 'spki' }),
  },
];
const receipt = {
  orderId: order,
  method: 'cash',
  status: 'reconciled_cash',
  amountMinor: 2_000_000,
  receiptReference: 'TILL-RECEIPT-123',
  reconciliationReference: 'TILL-CLOSEOUT-123',
  occurredAt: '2026-11-22T13:55:00Z',
};
const manifest = {
  version: 1,
  targetOrigin: target,
  sourceId: 'finance-01',
  merchantId: merchant,
  issuedAt: '2026-11-22T13:58:00Z',
  receipts: [receipt],
};

function signed(input: unknown) {
  const bytes = Buffer.from(JSON.stringify(input));
  return { bytes, signature: sign(null, bytes, privateKey).toString('base64') };
}

function invoke(
  payload = signed(manifest),
  options: { url?: string; registry?: unknown; fetchRpc?: typeof fetch } = {}
) {
  return importTenderManifest({
    ...payload,
    registry: options.registry ?? registry,
    url: options.url ?? target,
    serviceKey: 'synthetic-service-role-key',
    now,
    fetchRpc: options.fetchRpc ?? vi.fn(async () => Response.json([evidence])),
  });
}

describe('approved tender exports', () => {
  it.each([
    [receipt],
    [
      {
        ...receipt,
        method: 'pos',
        status: 'settled_pos',
        receiptReference: 'TERMINAL-RRN-123',
      },
    ],
  ])('imports one independently reconciled receipt into its signed target', async (entry) => {
    const fetchRpc = vi.fn(async () => Response.json([evidence]));
    expect(
      await invoke(signed({ ...manifest, receipts: [entry] }), { fetchRpc })
    ).toEqual([evidence]);
    expect(fetchRpc).toHaveBeenCalledOnce();
    const [url, init] = fetchRpc.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(`${target}/rest/v1/rpc/import_paid_order_tender_receipts`);
    expect(init.redirect).toBe('error');
    expect(JSON.parse(init.body as string)).toMatchObject({
      p_merchant_id: merchant,
      p_source_id: 'finance-01',
      p_receipts: [
        { orderId: order, method: entry.method, amountMinor: 2_000_000 },
      ],
    });
  });

  it('rejects tampering, credentials sent to another host, and out-of-scope signers', async () => {
    const payload = signed(manifest);
    const fetchRpc = vi.fn();
    await expect(
      invoke(
        {
          ...payload,
          bytes: signed({
            ...manifest,
            receipts: [{ ...receipt, amountMinor: 1 }],
          }).bytes,
        },
        { fetchRpc }
      )
    ).rejects.toThrow('signature');
    await expect(
      invoke(payload, { url: 'https://another.example.invalid', fetchRpc })
    ).rejects.toThrow('target');
    await expect(
      invoke(payload, {
        registry: [{ ...registry[0], methods: ['pos'] }],
        fetchRpc,
      })
    ).rejects.toThrow('scope');
    expect(fetchRpc).not.toHaveBeenCalled();
  });

  it('rejects unsettled, future-dated or duplicate source entries before posting', async () => {
    const fetchRpc = vi.fn();
    for (const item of [
      {
        ...manifest,
        receipts: [{ ...receipt, method: 'pos', status: 'authorized' }],
      },
      { ...manifest, issuedAt: '2026-11-23T00:00:00Z' },
      {
        ...manifest,
        receipts: [
          receipt,
          {
            ...receipt,
            receiptReference: receipt.receiptReference.toLowerCase(),
          },
        ],
      },
    ]) {
      await expect(invoke(signed(item), { fetchRpc })).rejects.toThrow();
    }
    expect(fetchRpc).not.toHaveBeenCalled();
  });

  it('rejects manifests older than the replay window before posting', async () => {
    const fetchRpc = vi.fn();
    const expired = new Date(now.getTime() - tenderManifestMaxAgeMs - 1);
    const issuedAt = expired.toISOString();
    await expect(
      invoke(
        signed({
          ...manifest,
          issuedAt,
          receipts: [{ ...receipt, occurredAt: '2026-11-21T13:59:00Z' }],
        }),
        { fetchRpc }
      )
    ).rejects.toThrow('timestamps are invalid');
    expect(fetchRpc).not.toHaveBeenCalled();
  });

  it('requires the shared POS receipt-reference format before posting', async () => {
    const fetchRpc = vi.fn();
    for (const receiptReference of ['SHORT7', '-POS-12345']) {
      await expect(
        invoke(
          signed({
            ...manifest,
            receipts: [
              {
                ...receipt,
                method: 'pos',
                status: 'settled_pos',
                receiptReference,
              },
            ],
          }),
          { fetchRpc }
        )
      ).rejects.toThrow();
    }
    expect(fetchRpc).not.toHaveBeenCalled();
  });

  it('accepts reconciliation references across the import database 8 to 120 range', async () => {
    const fetchRpc = vi.fn(async () => Response.json([evidence]));
    for (const reconciliationReference of [
      'A'.repeat(8),
      'reconciliation reference with punctuation !'.repeat(2),
      'R'.repeat(120),
    ]) {
      await expect(
        invoke(
          signed({
            ...manifest,
            receipts: [{ ...receipt, reconciliationReference }],
          }),
          { fetchRpc }
        )
      ).resolves.toEqual([evidence]);
    }
    expect(fetchRpc).toHaveBeenCalledTimes(3);
  });

  it('rejects reconciliation references above the batch SQL limit', async () => {
    const fetchRpc = vi.fn();
    for (const reconciliationReference of ['R'.repeat(121), 'R'.repeat(160)]) {
      await expect(
        invoke(
          signed({
            ...manifest,
            receipts: [{ ...receipt, reconciliationReference }],
          }),
          { fetchRpc }
        )
      ).rejects.toThrow();
    }
    expect(fetchRpc).not.toHaveBeenCalled();
  });

  it('reports a malformed database origin without posting a receipt', async () => {
    const fetchRpc = vi.fn();
    await expect(
      invoke(signed(manifest), { url: 'not a URL', fetchRpc })
    ).rejects.toThrow('Invalid receipt import target origin.');
    expect(fetchRpc).not.toHaveBeenCalled();
  });
});
