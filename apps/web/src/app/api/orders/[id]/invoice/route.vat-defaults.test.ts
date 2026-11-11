import { expect, it, vi } from 'vitest';
import { invoiceTestSupport } from './route.test-support';

const {
  cookies,
  NextRequest,
  generatePeppolInvoiceXml,
  generateReceiptBlob,
  resolveReceiptLogoDataUri,
  createClient,
  createSupabaseMock,
  GET,
  ORDER_ID,
  orderResult,
} = invoiceTestSupport;

it('uses the same missing VAT defaults as storefront invoices', async () => {
  vi.mocked(cookies).mockResolvedValue({ get: vi.fn() } as never);
  vi.mocked(generatePeppolInvoiceXml).mockReturnValue('<Invoice />');
  vi.mocked(generateReceiptBlob).mockResolvedValue(new Blob(['invoice']));
  vi.mocked(resolveReceiptLogoDataUri).mockResolvedValue(null);
  const source = orderResult.data as Record<string, unknown>;
  const merchant = source.merchants as Record<string, unknown>;
  vi.mocked(createClient).mockReturnValue(
    createSupabaseMock({
      order: {
        ...orderResult,
        data: {
          ...source,
          merchants: {
            ...merchant,
            vat_registration_status: null,
            vat_rate: null,
          },
        },
      },
    }) as unknown as ReturnType<typeof createClient>
  );

  const response = await GET(
    new NextRequest(`http://localhost/api/orders/${ORDER_ID}/invoice`),
    { params: Promise.resolve({ id: ORDER_ID }) }
  );
  expect(response.status).toBe(200);
  expect(generatePeppolInvoiceXml).toHaveBeenCalledWith(
    expect.objectContaining({
      merchant: expect.objectContaining({
        vat_registration_status: 'unregistered',
        vat_rate: 0,
      }),
    })
  );
});
