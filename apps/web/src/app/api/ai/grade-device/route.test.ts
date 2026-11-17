import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateContent: vi.fn(),
  verifyCsrf: vi.fn(),
  resolveMerchant: vi.fn(),
  productQuery: {
    eq: vi.fn(),
    ilike: vi.fn(),
    order: vi.fn(),
    result: { data: [] as unknown, error: null as unknown },
  },
}));

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn(function GoogleGenerativeAIMock() {
    return {
      getGenerativeModel: () => ({ generateContent: mocks.generateContent }),
    };
  }),
}));

vi.mock('@/env', () => ({ getRootDomain: () => 'usebaci.com' }));

vi.mock('@/lib/csrf', () => ({ verifyCsrfToken: mocks.verifyCsrf }));

vi.mock('@/lib/storefront-merchant', () => ({
  resolveStorefrontMerchantFromRequest: mocks.resolveMerchant,
}));

vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: () => ({
    from: (table: string) => {
      if (table !== 'products') throw new Error(`Unexpected table: ${table}`);
      const chain = {
        select: () => chain,
        eq: (...args: unknown[]) => {
          mocks.productQuery.eq(...args);
          return chain;
        },
        ilike: (...args: unknown[]) => {
          mocks.productQuery.ilike(...args);
          return chain;
        },
        gt: () => chain,
        order: (...args: unknown[]) => {
          mocks.productQuery.order(...args);
          return chain;
        },
        range: () => chain,
        returns: () => Promise.resolve(mocks.productQuery.result),
      };
      return chain;
    },
  }),
}));

import { DEVICE_GRADING_MAX_UPLOAD_BYTES } from '@/schemas/device-grading';
import { POST } from './route';
import {
  framesUpload,
  post,
  postWithCookies,
  videoUpload,
} from './route.test-support';

function aiAnswers(answer: unknown) {
  mocks.generateContent.mockResolvedValue({
    response: { text: () => JSON.stringify(answer) },
  });
}

describe('POST /api/ai/grade-device', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyCsrf.mockResolvedValue(true);
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    aiAnswers({
      model: 'iPhone 13 Pro',
      grade: 'Good',
      observations: ['Minor frame scratches', 'Screen looks intact'],
    });
    mocks.resolveMerchant.mockResolvedValue({
      success: true,
      identifier: 'ogabassey',
      merchant: { id: 'merchant-1', is_published: true },
    });
    mocks.productQuery.result = {
      data: [{ name: 'Apple iPhone 13 Pro 256GB', price: 750000 }],
      error: null,
    };
  });

  it('grades a mobile-app upload that carries no CSRF token or cookie', async () => {
    const response = await POST(post(videoUpload()));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.verifyCsrf).not.toHaveBeenCalled();
    expect(body).toEqual({
      success: true,
      data: {
        model: 'iPhone 13 Pro',
        grade: 'Good',
        observations: ['Minor frame scratches', 'Screen looks intact'],
        basePrice: 750000,
        estimatedValue: 450000,
        deductionPercent: 40,
        matchedProduct: 'Apple iPhone 13 Pro 256GB',
      },
    });
  });

  it('rejects a browser request that carries cookies but no valid CSRF token', async () => {
    mocks.verifyCsrf.mockResolvedValue(false);
    const request = postWithCookies(videoUpload());

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'CSRF validation failed' });
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it('does not let an Authorization header waive CSRF for a cookie-carrying request', async () => {
    mocks.verifyCsrf.mockResolvedValue(false);
    const request = postWithCookies(videoUpload());
    request.headers.set('authorization', 'Bearer anything');

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it('grades a browser request whose CSRF token is valid', async () => {
    const request = postWithCookies(videoUpload());

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mocks.verifyCsrf).toHaveBeenCalledWith(request);
  });

  it('prices only against the resolved store’s active products', async () => {
    await POST(post(videoUpload()));

    expect(mocks.productQuery.eq).toHaveBeenCalledWith(
      'merchant_id',
      'merchant-1'
    );
    expect(mocks.productQuery.eq).toHaveBeenCalledWith('status', 'active');
  });

  it.each([
    ['Excellent', 525000],
    ['Good', 450000],
    ['Fair', 375000],
    ['Poor', 225000],
  ])('offers a %s device a share of the cheapest matching listing', async (grade, offer) => {
    aiAnswers({ model: 'iPhone 13 Pro', grade, observations: [] });

    const response = await POST(post(videoUpload()));

    expect((await response.json()).data.estimatedValue).toBe(offer);
    expect(mocks.productQuery.order).toHaveBeenCalledWith('price', {
      ascending: true,
    });
  });

  it('accepts still frames and sends each one to the model', async () => {
    const response = await POST(post(framesUpload(4)));

    expect(response.status).toBe(200);
    const parts = mocks.generateContent.mock.calls[0]?.[0] as unknown[];
    expect(parts).toHaveLength(5);
    expect(parts[1]).toEqual({
      inlineData: { data: 'AQID', mimeType: 'image/jpeg' },
    });
  });

  it('returns 400 when no media is provided', async () => {
    const response = await POST(post(new FormData()));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'No video file provided' });
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it('returns 400 for a malformed upload body', async () => {
    const request = new NextRequest(
      'https://ogabassey.com/api/ai/grade-device',
      {
        method: 'POST',
        body: 'not-a-form',
        headers: { 'content-type': 'multipart/form-data; boundary=x' },
      }
    );

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Invalid upload',
      code: 'INVALID_UPLOAD',
    });
  });

  it('rejects an upload above the size budget before calling the model', async () => {
    const response = await POST(
      post(videoUpload(DEVICE_GRADING_MAX_UPLOAD_BYTES + 1))
    );

    expect(response.status).toBe(413);
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it('rejects frames that are not images and too many frames', async () => {
    const wrongType = await POST(post(framesUpload(1, 'text/html')));
    const tooMany = await POST(post(framesUpload(7)));

    expect(wrongType.status).toBe(400);
    expect(tooMany.status).toBe(400);
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it('does not call the model when the storefront cannot be resolved', async () => {
    mocks.resolveMerchant.mockResolvedValue({
      success: false,
      status: 404,
      error: 'Device check is only available on storefront hosts',
    });

    const response = await POST(post(videoUpload()));

    expect(response.status).toBe(404);
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it('returns a safe error when the model call fails', async () => {
    mocks.generateContent.mockRejectedValue(
      new Error('429 quota exceeded for key AIza-secret')
    );

    const response = await POST(post(videoUpload()));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.code).toBe('ANALYSIS_FAILED');
    expect(JSON.stringify(body)).not.toContain('AIza');
  });

  it('reports malformed model output as unreadable, not as a transient failure', async () => {
    mocks.generateContent.mockResolvedValue({
      response: { text: () => 'Sorry, I cannot tell {' },
    });

    const response = await POST(post(videoUpload()));

    expect(response.status).toBe(502);
    expect((await response.json()).code).toBe('ANALYSIS_UNREADABLE');
  });

  it('rejects a model answer outside the expected shape', async () => {
    aiAnswers({ model: 'iPhone 13 Pro', grade: 'Mint', observations: [] });

    const response = await POST(post(videoUpload()));

    expect(response.status).toBe(502);
    expect((await response.json()).code).toBe('ANALYSIS_UNREADABLE');
    expect(mocks.productQuery.eq).not.toHaveBeenCalled();
  });
});
