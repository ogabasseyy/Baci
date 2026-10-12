import { NextRequest, NextResponse } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ handler: vi.fn() }));

vi.mock('@/lib/customer-savings-catalogue-handler', () => ({
  handleCustomerSavingsCatalogue: mocks.handler,
}));

import { GET } from './route';

describe('customer savings catalogue route', () => {
  it('forwards the actual GET request to the restricted handler', async () => {
    const request = new NextRequest(
      'http://localhost/api/storefront/customer/savings/drafts/catalogue?merchantId=10000000-0000-4000-8000-000000000001&search=&page=0',
      { headers: { authorization: 'Bearer customer-token' } }
    );
    const expected = NextResponse.json({ products: [] });
    mocks.handler.mockResolvedValue(expected);

    const response = await GET(request);

    expect(response).toBe(expected);
    expect(mocks.handler).toHaveBeenCalledOnce();
    expect(mocks.handler).toHaveBeenCalledWith(request);
  });
});
