import { expect, it, vi } from 'vitest';
import { scheduleJourneyFixture } from './piggyvest-schedule.test-support';

it('prevents POST when presentation is replaced during CSRF before effect cleanup', async () => {
  const fixture = scheduleJourneyFixture();
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    const response = Response.json(
      init?.method === 'POST'
        ? await fixture.submit(JSON.parse(String(init.body)))
        : await fixture.read()
    );
    Object.defineProperty(response, 'url', { value: String(url) });
    return response;
  });
  let replace = false;
  let current = true;
  const binding = await createPiggyvestScheduleClientBinding({
    ...fixture.options,
    http: {
      configuration: {
        mode: 'local_test',
        baseUrl: 'http://127.0.0.1:3000',
        endpointPath: '/schedule',
      },
      fetch,
      getCsrfToken: async () => {
        if (replace) current = false;
        return 'synthetic';
      },
    },
  });
  binding.setViewGuard(() => current);
  replace = true;
  const calls = fetch.mock.calls.length;
  await expect(binding.requestResume(true, 1)).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(calls);
});

import { createPiggyvestScheduleClientBinding } from './piggyvest-schedule-client-binding';

it('connects GET observe POST and latest GET, retaining ambiguous HTTP pause for readback', async () => {
  const fixture = scheduleJourneyFixture();
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    const value =
      init?.method === 'POST'
        ? await fixture.submit(JSON.parse(String(init.body)))
        : await fixture.read(
            new URL(String(url)).searchParams.get('operationId') ?? undefined
          );
    const response = Response.json(value);
    Object.defineProperty(response, 'url', { value: String(url) });
    return response;
  });
  const binding = await createPiggyvestScheduleClientBinding({
    ...fixture.options,
    http: {
      configuration: {
        mode: 'local_test',
        baseUrl: 'http://127.0.0.1:3000',
        endpointPath: '/schedule',
      },
      fetch,
      getCsrfToken: async () => 'synthetic',
    },
  });
  expect(fetch).toHaveBeenCalledTimes(3);
  fixture.loseAcknowledgement();
  await expect(binding.pause()).rejects.toThrow();
  expect(binding.getPendingOperationId()).not.toBeNull();
  await binding.refresh();
  expect(binding.read(fixture.source)?.status).toBe('ready');
  binding.invalidate();
  expect(binding.read(fixture.source)).toBeNull();
});
