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

const id = (n: number) => `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`;

describe('fetchAppQuizEvents', () => {
  it('requests the v2 contract listing for the store', async () => {
    apiGetMock.mockResolvedValue(appQuizEventsResponse([appQuizEvent()]));

    await fetchAppQuizEvents('ogabassey');

    expect(apiGetMock).toHaveBeenCalledWith(
      '/api/quiz/events?limit=50&merchantSlug=ogabassey&offset=0',
      { headers: { 'X-Baci-Quiz-Contract': '2' } }
    );
  });

  it('keeps only quizzes a shopper can still join', async () => {
    apiGetMock.mockResolvedValue(
      appQuizEventsResponse([
        appQuizEvent({ id: id(1) }),
        appQuizEvent({ id: id(2), status: 'scheduled' }),
        appQuizEvent({ id: id(3), status: 'completed' }),
        appQuizEvent({ id: id(4), status: 'finalizing' }),
      ])
    );

    const events = await fetchAppQuizEvents('ogabassey');

    expect(events.map((event) => event.status)).toEqual([
      'active',
      'scheduled',
    ]);
  });

  describe('bugfix: live quiz pushed off the first page', () => {
    it('follows pagination so a live quiz on a later page is still listed', async () => {
      apiGetMock
        .mockResolvedValueOnce(
          appQuizEventsResponse([appQuizEvent({ id: id(1), status: 'completed' })], {
            hasMore: true,
            nextOffset: 50,
            offset: 0,
          })
        )
        .mockResolvedValueOnce(
          appQuizEventsResponse([appQuizEvent({ id: id(2) })], {
            hasMore: false,
            nextOffset: null,
            offset: 50,
          })
        );

      const events = await fetchAppQuizEvents('ogabassey');

      expect(events.map((event) => event.id)).toEqual([id(2)]);
      expect(apiGetMock).toHaveBeenLastCalledWith(
        '/api/quiz/events?limit=50&merchantSlug=ogabassey&offset=50',
        { headers: { 'X-Baci-Quiz-Contract': '2' } }
      );
    });

    it('stops after a bounded number of pages', async () => {
      apiGetMock.mockImplementation(async (url: string) => {
        const offset = Number(new URL(url, 'https://x.test').searchParams.get('offset'));
        return appQuizEventsResponse([], {
          hasMore: true,
          nextOffset: offset + 50,
          offset,
        });
      });

      await fetchAppQuizEvents('ogabassey');

      expect(apiGetMock).toHaveBeenCalledTimes(10);
    });
  });

  it('rejects a response that is not the v2 contract', async () => {
    apiGetMock.mockResolvedValue({ events: [{ id: 'legacy' }] });

    await expect(fetchAppQuizEvents('ogabassey')).rejects.toThrow(
      'Invalid quiz response'
    );
  });
});
