import { expect, it, vi } from 'vitest';
import { logger } from '@/lib/logger';
import { mocks, POST, request } from './route.test-support';

it.each([
  'GH',
  null,
])('rejects origin country %j before asking GIG for a quote', async (country) => {
  using warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
  mocks.sender.mockResolvedValueOnce({
    ok: true,
    country,
    sender: { city: 'Ikeja', state: 'Lagos', countryCode: 'NG' },
  });
  const response = await POST(request());
  expect(response.status).toBe(503);
  const body = await response.json();
  expect(body.error.code).toBe('QUOTE_ORIGIN_UNAVAILABLE');
  expect(warn).toHaveBeenCalledExactlyOnceWith({
    message: 'Partner quote sender configuration is invalid',
    connectionId: 'crossrem-ogabassey',
    requestId: body.request_id,
  });
  expect(mocks.rates).not.toHaveBeenCalled();
});

it.each([
  '',
  'not-a-phone',
  '+23415781',
])('holds quotes when the pickup phone is invalid (%j)', async (phone) => {
  using warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
  mocks.sender.mockResolvedValueOnce({
    ok: true,
    country: 'NG',
    sender: { city: 'Ikeja', state: 'Lagos', countryCode: 'NG', phone },
  });

  const response = await POST(request());
  expect(response.status).toBe(503);
  const body = await response.json();
  expect(body.error.code).toBe('QUOTE_ORIGIN_UNAVAILABLE');
  expect(warn).toHaveBeenCalledExactlyOnceWith({
    message: 'Partner quote sender configuration is invalid',
    connectionId: 'crossrem-ogabassey',
    requestId: body.request_id,
  });
  expect(mocks.rates).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
