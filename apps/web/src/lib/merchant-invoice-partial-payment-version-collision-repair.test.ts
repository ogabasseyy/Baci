import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrations = join(process.cwd(), '../../supabase/migrations');

describe('merchant invoice partial-payment version collision repair', () => {
  it('replays every byte of the colliding Paystack migration in dependency order', async () => {
    const [original, reviewContract, completionFunction] = await Promise.all([
      readFile(
        join(
          migrations,
          '20260805090000_complete_merchant_invoice_partial_payments.sql'
        )
      ),
      readFile(
        join(
          migrations,
          '20260805090001_reapply_merchant_invoice_partial_review_contract.sql'
        )
      ),
      readFile(
        join(
          migrations,
          '20260805090002_reapply_complete_merchant_invoice_partial_payment.sql'
        )
      ),
    ]);

    expect(Buffer.concat([reviewContract, completionFunction])).toEqual(
      original
    );
  });
});
