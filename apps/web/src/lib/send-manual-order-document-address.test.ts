// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendEmail = vi.hoisted(() => vi.fn());
vi.mock('@/env', () => ({ getRootDomain: () => 'usebaci.com' }));
vi.mock('@/lib/zeptomail', () => ({ sendEmail }));
vi.mock('@/lib/receipt-pdf-generator', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/receipt-pdf-generator')>()),
  resolveReceiptLogoDataUri: vi.fn().mockResolvedValue(null),
}));

import { database, row } from './manual-order-document.test-utils';
import { sendManualOrderDocument } from './send-manual-order-document';

describe('send manual order document registered address', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendEmail.mockImplementation(async (message) => {
      await message.beforeTransportDispatch?.();
      return { success: true, messageId: 'message-1' };
    });
  });

  it('prints the registered seller address on emailed invoices', async () => {
    const db = database(
      { payment_status: 'unpaid', amount_paid: 0 },
      {
        merchantOverride: {
          registered_address: {
            street: '12 Marina Street',
            city: 'Lagos',
            state: 'Lagos',
            postal_code: null,
            country: 'Nigeria',
          },
        },
      }
    );
    await sendManualOrderDocument({
      supabase: db.client,
      row: { ...row, event_type: 'manual_order_invoice' },
    });
    const pdf = Buffer.from(
      sendEmail.mock.calls[0][0].attachments[0].content,
      'base64'
    ).toString('latin1');
    expect(pdf).toContain('12 Marina Street');
  });

  it('snapshots the raw registered address the RPC compares against', async () => {
    for (const registered_address of [
      '12 Marina Street',
      { city: 'Lagos', legacy_note: 'handover' },
    ]) {
      const db = database(
        { payment_status: 'unpaid', amount_paid: 0 },
        { merchantOverride: { registered_address } }
      );
      await sendManualOrderDocument({
        supabase: db.client,
        row: { ...row, event_type: 'manual_order_invoice' },
      });
      const markCall = db.rpc.mock.calls.find(
        ([fn]) => fn === 'mark_manual_document_dispatch_started'
      );
      expect(markCall?.[1]).toMatchObject({
        p_merchant_registered_address: registered_address,
      });
    }
  });
});
