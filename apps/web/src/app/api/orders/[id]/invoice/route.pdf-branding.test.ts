import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoiceTestSupport } from './route.test-support';

const {
  cookies,
  NextRequest,
  generatePeppolInvoiceXml,
  generateReceiptBlob,
  resolveReceiptLogoDataUri,
  createClient,
  GET,
  ORDER_ID,
  createSupabaseMock,
} = invoiceTestSupport;

describe('GET /api/orders/[id]/invoice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cookies).mockResolvedValue({ get: vi.fn() } as never);
    vi.mocked(generatePeppolInvoiceXml).mockReturnValue('<Invoice />');
    vi.mocked(generateReceiptBlob).mockResolvedValue(new Blob(['invoice']));
    vi.mocked(resolveReceiptLogoDataUri).mockResolvedValue(
      'data:image/png;base64,AA=='
    );
    vi.mocked(createClient).mockReturnValue(
      createSupabaseMock() as unknown as ReturnType<typeof createClient>
    );
  });

  it('generates the invoice with fallback branding when logo resolution fails', async () => {
    vi.mocked(resolveReceiptLogoDataUri).mockRejectedValueOnce(
      new Error('logo fetch failed')
    );

    const response = await GET(
      new NextRequest(`http://localhost/api/orders/${ORDER_ID}/invoice`),
      { params: Promise.resolve({ id: ORDER_ID }) }
    );

    expect(response.status).toBe(200);
    expect(generateReceiptBlob).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      expect.objectContaining({ logoDataUri: null })
    );
  });
});
