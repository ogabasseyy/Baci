import { expect, it, vi } from 'vitest';
import { scheduleJourneyFixture } from './piggyvest-schedule.test-support';
import { createPiggyvestScheduleClient } from './piggyvest-schedule-client';

function fixture() {
  const data = scheduleJourneyFixture();
  const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
    const response = Response.json(data.snapshot());
    Object.defineProperty(response, 'url', { value: String(url) });
    return response;
  });
  const options = {
    configuration: {
      mode: 'local_test',
      baseUrl: 'http://127.0.0.1:3000',
      endpointPath: '/schedule',
      credentials: 'same-origin',
    },
    goalId: data.goalId,
    fetch,
    getCsrfToken: vi.fn(async () => 'synthetic'),
    isCurrent: vi.fn(() => true),
  };
  return { ...data, fetch, options };
}
it('uses exact authenticated local GET and rejects authority fields before HTTP', async () => {
  const data = fixture();
  const client = createPiggyvestScheduleClient(data.options);
  expect(await client.read()).toEqual(data.snapshot());
  expect(data.fetch.mock.calls[0]).toMatchObject([
    `http://127.0.0.1:3000/schedule?goalId=${data.goalId}`,
    { method: 'GET', credentials: 'same-origin', redirect: 'error' },
  ]);
  await expect(
    client.submit({
      operationId: data.goalId,
      command: { action: 'pause', goalId: data.goalId, expectedVersion: 0 },
      actorId: data.goalId,
    })
  ).rejects.toThrow();
  expect(data.fetch).toHaveBeenCalledTimes(1);
});
it('strictly rejects malformed private response or wrong operation history', async () => {
  const data = fixture();
  data.fetch.mockImplementation(async (url) => {
    const response = Response.json({
      ...data.snapshot(),
      actorId: data.goalId,
    });
    Object.defineProperty(response, 'url', { value: String(url) });
    return response;
  });
  await expect(
    createPiggyvestScheduleClient(data.options).read()
  ).rejects.toThrow('Schedule unavailable');
});
it('stops a pending CSRF request on current-context replacement', async () => {
  const data = fixture();
  data.options.getCsrfToken.mockImplementation(async () => {
    data.options.isCurrent.mockReturnValue(false);
    return 'synthetic';
  });
  await expect(
    createPiggyvestScheduleClient(data.options).submit({
      operationId: data.goalId,
      command: { action: 'pause', goalId: data.goalId, expectedVersion: 0 },
    })
  ).rejects.toThrow();
  expect(data.fetch).not.toHaveBeenCalled();
});
