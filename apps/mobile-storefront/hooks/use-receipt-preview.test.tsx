import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { useReceiptPreview } from './use-receipt-preview';
import { unpaidProformaDetail } from './use-receipt-preview.test-fixture';

let mockReceiptDetail: Record<string, unknown> | null = null;

jest.mock('./use-receipts', () => ({
  useMerchantReceiptInfo: () => ({
    data: {
      business_name: 'Baci Store',
      logo_url: null,
      email: 'merchant@example.com',
      phone: null,
      support_email: null,
      support_phone: null,
      business_address: null,
      cac_rc_number: null,
      tax_identification_number: null,
      legal_entity_name: null,
      brand_colors: null,
      vat_registration_status: null,
      vat_rate: null,
      bank_code: '999',
      bank_account_number: '1234567890',
      bank_name: 'Baci Bank',
      bank_account_name: 'Baci Store Ltd',
      social_media: null,
      pages: null,
    },
  }),
  useReceiptDetail: () => ({ data: mockReceiptDetail }),
}));

describe('useReceiptPreview foreign-currency bank details', () => {
  it('omits the NGN merchant account from USD previews', () => {
    mockReceiptDetail = unpaidProformaDetail('USD');
    const { result } = renderHook(() => useReceiptPreview());

    act(() => {
      result.current.openPreviewByOrderId('order-1');
    });

    expect(result.current.isOpen).toBe(true);
    expect(result.current.html).not.toContain('1234567890');
    expect(result.current.html).not.toContain('Baci Bank');
  });

  it('keeps the merchant account for NGN previews', () => {
    mockReceiptDetail = unpaidProformaDetail('NGN');
    const { result } = renderHook(() => useReceiptPreview());

    act(() => {
      result.current.openPreviewByOrderId('order-1');
    });

    expect(result.current.isOpen).toBe(true);
    expect(result.current.html).toContain('1234567890');
  });

  it('strips a persisted virtual account from USD previews', () => {
    mockReceiptDetail = {
      ...unpaidProformaDetail('USD'),
      virtual_account: {
        account_number: '0987654321',
        bank_name: 'Wema Bank',
        account_name: 'Ogabassey Ltd',
      },
    };
    const { result } = renderHook(() => useReceiptPreview());

    act(() => {
      result.current.openPreviewByOrderId('order-1');
    });

    // The renderer prefers the order-level account, so the merchant-only
    // guard is not enough: the naira DVA must not print beside a
    // dollar-denominated balance.
    expect(result.current.isOpen).toBe(true);
    expect(result.current.html).not.toContain('0987654321');
    expect(result.current.html).not.toContain('Wema Bank');
  });

  it('keeps a persisted virtual account for NGN previews', () => {
    mockReceiptDetail = {
      ...unpaidProformaDetail('NGN'),
      virtual_account: {
        account_number: '0987654321',
        bank_name: 'Wema Bank',
        account_name: 'Ogabassey Ltd',
      },
    };
    const { result } = renderHook(() => useReceiptPreview());

    act(() => {
      result.current.openPreviewByOrderId('order-1');
    });

    expect(result.current.isOpen).toBe(true);
    expect(result.current.html).toContain('0987654321');
  });
});

describe('useReceiptPreview document kind', () => {
  it('derives proforma for a never-paid invoice opened without a kind', () => {
    mockReceiptDetail = unpaidProformaDetail('NGN');
    const { result } = renderHook(() => useReceiptPreview());

    act(() => {
      result.current.openPreviewByOrderId('order-1');
    });

    expect(result.current.isOpen).toBe(true);
    expect(result.current.html).toContain(
      '<div class="doc-title">Proforma Invoice</div>'
    );
    expect(result.current.html).not.toContain(
      '<div class="doc-title">Invoice</div>'
    );
  });

  it('keeps the commercial title for a wallet-credited invoice without a kind', () => {
    mockReceiptDetail = {
      ...unpaidProformaDetail('NGN'),
      amount_paid: 20000,
    };
    const { result } = renderHook(() => useReceiptPreview());

    act(() => {
      result.current.openPreviewByOrderId('order-1');
    });

    expect(result.current.isOpen).toBe(true);
    expect(result.current.html).not.toContain('Proforma Invoice');
  });

  it('keeps the commercial title for a partially paid invoice without a kind', () => {
    mockReceiptDetail = {
      ...unpaidProformaDetail('NGN'),
      payment_status: 'partially_paid',
    };
    const { result } = renderHook(() => useReceiptPreview());

    act(() => {
      result.current.openPreviewByOrderId('order-1');
    });

    expect(result.current.isOpen).toBe(true);
    expect(result.current.html).not.toContain('Proforma Invoice');
  });

  it('preserves an explicit stored type code instead of deriving proforma', () => {
    mockReceiptDetail = {
      ...unpaidProformaDetail('NGN'),
      invoice_type_code: '381',
    };
    const { result } = renderHook(() => useReceiptPreview());

    act(() => {
      result.current.openPreviewByOrderId('order-1');
    });

    expect(result.current.isOpen).toBe(true);
    expect(result.current.html).not.toContain('Proforma Invoice');
  });

  it('renders invoice terms/notes/FIRS from the detail like the PDF', () => {
    mockReceiptDetail = {
      ...unpaidProformaDetail('NGN'),
      invoice_note: 'Handle with care',
      payment_due_date: '2026-05-20',
      payment_terms: 'Net 30',
      buyer_reference: 'PO-77',
      firs_irn: 'IRN-1',
      firs_csid: 'CSID-2',
    };
    const { result } = renderHook(() => useReceiptPreview());

    act(() => {
      result.current.openPreviewByOrderId('order-1');
    });

    expect(result.current.html).toContain('Invoice Terms');
    expect(result.current.html).toContain('Payment Terms: Net 30');
    expect(result.current.html).toContain('Handle with care');
    expect(result.current.html).toContain('FIRS IRN: IRN-1');
  });

  it('prefers an explicit caller kind over the derived one', () => {
    mockReceiptDetail = {
      ...unpaidProformaDetail('NGN'),
      payment_status: 'paid',
    };
    const { result } = renderHook(() =>
      useReceiptPreview({ documentKind: 'proforma' })
    );

    act(() => {
      result.current.openPreviewByOrderId('order-1');
    });

    // The generator itself resolves a paid order to a receipt even with
    // a stale explicit kind — the hook must forward, never rewrite.
    expect(result.current.isOpen).toBe(true);
    expect(result.current.html).toContain(
      '<div class="doc-title">Receipt</div>'
    );
  });

  it('counts legacy paid spellings on non-manual orders like web', () => {
    mockReceiptDetail = {
      ...unpaidProformaDetail('NGN'),
      payment_status: ' Paid ',
    };
    const preview = renderHook(() => useReceiptPreview());
    act(() => {
      preview.result.current.openPreviewByOrderId('order-1');
    });
    expect(preview.result.current.documentKind).toBe('receipt');
  });

  it('reports the effective kind the artifact was built with', () => {
    // Derived proforma: modal chrome must read proforma, not commercial.
    mockReceiptDetail = unpaidProformaDetail('NGN');
    const derived = renderHook(() => useReceiptPreview());
    act(() => {
      derived.result.current.openPreviewByOrderId('order-1');
    });
    expect(derived.result.current.documentKind).toBe('proforma');

    // Stale explicit proforma on a paid order: the generator renders the
    // commercial receipt, so the chrome must read receipt too.
    mockReceiptDetail = {
      ...unpaidProformaDetail('NGN'),
      payment_status: 'paid',
    };
    const overridden = renderHook(() =>
      useReceiptPreview({ documentKind: 'proforma' })
    );
    act(() => {
      overridden.result.current.openPreviewByOrderId('order-1');
    });
    expect(overridden.result.current.documentKind).toBe('receipt');

    // Commercial default: unpaid non-invoice without a kind.
    mockReceiptDetail = {
      ...unpaidProformaDetail('NGN'),
      payment_method: 'paystack',
    };
    const commercial = renderHook(() => useReceiptPreview());
    act(() => {
      commercial.result.current.openPreviewByOrderId('order-1');
    });
    expect(commercial.result.current.documentKind).toBe('invoice');
  });
});
