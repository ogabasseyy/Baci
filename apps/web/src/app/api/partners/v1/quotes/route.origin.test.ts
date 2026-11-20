import { expect, it, vi } from 'vitest';
import { logger } from '@/lib/logger';
import { mocks, POST, request } from './route.test-support';

it('logs an unsupported origin before asking GIG for a quote', async () => {
  using warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
  mocks.sender.mockResolvedValueOnce({
    ok: true,
    country: 'GH',
    sender: { city: 'Ikeja', state: 'Lagos', countryCode: 'NG' },
  });
  const response = await POST(request());
  expect(response.status).toBe(503);
  const body = await response.json();
  expect(body.error.code).toBe('QUOTE_UNAVAILABLE');
  expect(warn).toHaveBeenCalledExactlyOnceWith({
    message: 'Partner quote sender is missing or outside Nigeria',
    connectionId: 'crossrem-ogabassey',
    requestId: body.request_id,
  });
  expect(mocks.rates).not.toHaveBeenCalled();
});
