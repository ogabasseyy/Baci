import { beforeEach, expect, it, vi } from 'vitest';
import { invoiceTestSupport } from './route.test-support';

const {
  checkRateLimit,
  cookies,
  createClient,
  createSupabaseMock,
  GET,
  NextRequest,
  ORDER_ID,
} = invoiceTestSupport;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(cookies).mockResolvedValue({ get: vi.fn() } as never);
  vi.mocked(createClient).mockReturnValue(
    createSupabaseMock() as unknown as ReturnType<typeof createClient>
  );
});

it('rate limits authenticated merchant invoice downloads before order lookup', async () => {
  const supabase = createSupabaseMock();
  vi.mocked(createClient).mockReturnValue(
    supabase as unknown as ReturnType<typeof createClient>
  );
  vi.mocked(checkRateLimit).mockResolvedValueOnce(false);
  const response = await GET(
    new NextRequest(`https://example.com/api/orders/${ORDER_ID}/invoice`),
    { params: Promise.resolve({ id: ORDER_ID }) }
  );

  expect(response.status).toBe(429);
  expect(supabase.from).not.toHaveBeenCalled();
  expect(response.headers.get('Retry-After')).toBe('60');
  expect(checkRateLimit).toHaveBeenCalledWith(
    expect.anything(),
    expect.any(String),
    'merchant_invoice_download',
    10,
    1
  );
});
