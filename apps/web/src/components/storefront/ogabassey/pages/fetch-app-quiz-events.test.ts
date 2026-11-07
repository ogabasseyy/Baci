import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appQuizEvent,
  appQuizEventsResponse,
} from './app-quiz-event.test-support';
import { fetchAppQuizEvents } from './fetch-app-quiz-events';

const apiGetMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ apiGet: apiGetMock }));

beforeEach(() => {
  apiGetMock.mockReset();
});

describe('fetchAppQuizEvents', () => {
  it('makes one request for the current v2 events of the store', async () => {
    const event = appQuizEvent();
    apiGetMock.mockResolvedValue(appQuizEventsResponse([event]));

    const events = await fetchAppQuizEvents('ogabassey');

    expect(events).toEqual([event]);
    expect(apiGetMock).toHaveBeenCalledTimes(1);
    expect(apiGetMock).toHaveBeenCalledWith(
      '/api/quiz/events?current=1&merchantSlug=ogabassey',
      { headers: { 'X-Baci-Quiz-Contract': '2' } }
    );
  });

  it('rejects a response that is not the v2 contract', async () => {
    apiGetMock.mockResolvedValue({ events: [{ id: 'legacy' }] });

    await expect(fetchAppQuizEvents('ogabassey')).rejects.toThrow(
      'Invalid quiz response'
    );
  });
});
