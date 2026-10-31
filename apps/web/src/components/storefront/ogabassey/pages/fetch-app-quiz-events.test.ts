import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appQuizEvent, appQuizEventsResponse } from './app-quiz-event.test-support';
import { fetchAppQuizEvents } from './fetch-app-quiz-events';

const apiGetMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ apiGet: apiGetMock }));

beforeEach(() => {
  apiGetMock.mockReset();
});

describe('fetchAppQuizEvents', () => {
  it('requests the v2 contract listing for the store', async () => {
    apiGetMock.mockResolvedValue(appQuizEventsResponse([appQuizEvent()]));

    await fetchAppQuizEvents('ogabassey');

    expect(apiGetMock).toHaveBeenCalledWith(
      '/api/quiz/events?limit=20&merchantSlug=ogabassey&offset=0',
      { headers: { 'X-Baci-Quiz-Contract': '2' } }
    );
  });

  it('keeps only quizzes a shopper can still join', async () => {
    apiGetMock.mockResolvedValue(
      appQuizEventsResponse([
        appQuizEvent({ id: '22222222-2222-4222-8222-000000000001' }),
        appQuizEvent({ id: '22222222-2222-4222-8222-000000000002', status: 'scheduled' }),
        appQuizEvent({ id: '22222222-2222-4222-8222-000000000003', status: 'completed' }),
        appQuizEvent({ id: '22222222-2222-4222-8222-000000000004', status: 'finalizing' }),
      ])
    );

    const events = await fetchAppQuizEvents('ogabassey');

    expect(events.map((event) => event.status)).toEqual(['active', 'scheduled']);
  });

  it('rejects a response that is not the v2 contract', async () => {
    apiGetMock.mockResolvedValue({ events: [{ id: 'legacy' }] });

    await expect(fetchAppQuizEvents('ogabassey')).rejects.toThrow(
      'Invalid quiz response'
    );
  });
});
