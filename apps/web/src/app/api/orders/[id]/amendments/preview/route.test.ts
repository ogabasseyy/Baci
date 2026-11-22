import { describe, expect, it } from 'vitest';
import {
  context,
  id,
  mocks,
  replacementId,
  request,
} from '../amendment-route.test-support';
import { POST } from './route';

const body = {
  lineId: id,
  replacement: { id: replacementId, kind: 'variant' },
};

describe('POST order amendment preview', () => {
  it('requires an authenticated user', async () => {
    mocks.auth.mockResolvedValueOnce({ user: null });
    expect((await POST(request(body), context)).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects an unsupported replacement kind', async () => {
    const malformed = {
      ...body,
      replacement: { ...body.replacement, kind: 'unsupported' },
    };
    expect((await POST(request(malformed), context)).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('dispatches the validated replacement and order ID', async () => {
    expect((await POST(request(body), context)).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
      'preview_paid_order_amendment',
      {
        p_order_id: id,
        p_payload: body,
      }
    );
  });

  it('returns the rate-limit response when the database preview cap is reached', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: 'amendment_rate_limited' },
    });
    const response = await POST(request(body), context);
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
  });
});
