import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { connect, query, end, readFile, listRefunds } = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
  readFile: vi.fn(),
  listRefunds: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({ readFile }));
vi.mock('postgres', () => ({ default: connect }));
vi.mock('../lib/orders/list-paystack-refunds', () => ({
  listPaystackRefunds: listRefunds,
}));

import { runBankOfferPartialRefundCli } from './check-bank-offer-partial-refund.cli';

const orderId = '10000000-0000-4000-8000-000000000001';
const merchantId = '20000000-0000-4000-8000-000000000002';
const itemId = '30000000-0000-4000-8000-000000000003';
const argv = [orderId, merchantId, 'return.json'];
const databaseUrl = 'postgres://operator:private-test-password@localhost/db';

describe('bank-offer partial refund CLI', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.stubEnv('BANK_OFFER_REFUND_READ_DATABASE_URL', databaseUrl);
    connect.mockReturnValue(Object.assign(query, { end }));
    readFile.mockResolvedValue(
      JSON.stringify({
        units: [{ itemId, unitNumber: 1 }],
        previousRefunds: [],
      })
    );
    query.mockResolvedValue([
      {
        snapshot: {
          capture: {
            reference: 'BCO-capture',
            id: '9007199254740993',
            domain: 'test',
            amountKobo: 1000,
          },
          merchandiseNetKobo: 900,
          allocations: [{ itemId, unitNetAmountsKobo: [600, 300] }],
        },
      },
    ]);
    listRefunds.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('reads the order and merchant in a read-only session and verifies the saved capture', async () => {
    expect(await runBankOfferPartialRefundCli(argv)).toBe(0);
    expect(connect).toHaveBeenCalledWith(
      databaseUrl,
      expect.objectContaining({
        ssl: 'verify-full',
        connection: {
          default_transaction_read_only: true,
          statement_timeout: 5000,
        },
      })
    );
    expect(query).toHaveBeenCalledOnce();
    const [sql, ...values] = query.mock.calls[0] ?? [];
    expect(values).toEqual([orderId, merchantId]);
    const statement = sql.join('?');
    expect(statement).toMatch(/^\s*SELECT\b/);
    expect(statement).toContain('snapshot.order_id = ?::uuid');
    expect(statement).toContain('snapshot.merchant_id = ?::uuid');
    expect(statement).toContain('attempt.refund_dispatch_claim IS NULL');
    expect(statement).toContain(
      "effect.step = 'refund' AND effect.status <> 'completed'"
    );
    expect(listRefunds).toHaveBeenCalledWith('BCO-capture', {
      expectedCapture: {
        id: '9007199254740993',
        domain: 'test',
        amountKobo: 1000,
      },
      deadlineMs: expect.any(Number),
    });
    expect(console.log).toHaveBeenCalledWith(
      JSON.stringify({
        suggestedRefundKobo: 600,
        remainingPaystackKobo: 1000,
        returnedUnitCount: 1,
      })
    );
    expect(end).toHaveBeenCalledOnce();
  });

  it('skips Paystack when the scoped query returns no eligible capture', async () => {
    query.mockResolvedValue([]);
    expect(await runBankOfferPartialRefundCli(argv)).toBe(1);
    expect(listRefunds).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalledOnce();
  });

  it('closes the session and redacts database and provider errors', async () => {
    query.mockRejectedValueOnce(new Error(databaseUrl));
    listRefunds.mockRejectedValueOnce(new Error('private provider response'));
    expect(await runBankOfferPartialRefundCli(argv)).toBe(1);
    expect(await runBankOfferPartialRefundCli(argv)).toBe(1);
    expect(console.error).toHaveBeenNthCalledWith(
      1,
      'Could not read the return manifest or connect to the Operations database.'
    );
    expect(console.error).toHaveBeenNthCalledWith(
      2,
      'Could not verify the saved capture, allocations, or Paystack refund history.'
    );
    expect(console.log).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid arguments and manifests before touching the database', async () => {
    expect(await runBankOfferPartialRefundCli(['garbage'])).toBe(1);
    readFile.mockResolvedValueOnce(JSON.stringify({ units: [] }));
    expect(await runBankOfferPartialRefundCli(argv)).toBe(1);
    expect(connect).not.toHaveBeenCalled();
  });
});
