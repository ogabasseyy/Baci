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
    const offsetOf = (url: string) =>
      Number(new URL(url, 'https://x.test').searchParams.get('offset'));

    it('reads later pages so a live quiz on page two is still listed', async () => {
      apiGetMock.mockImplementation(async (url: string) => {
        const offset = offsetOf(url);
        if (offset === 0) {
          return appQuizEventsResponse(
            [appQuizEvent({ id: id(1), status: 'completed' })],
            { hasMore: true, nextOffset: 50, offset }
          );
        }
        if (offset === 50) {
          return appQuizEventsResponse([appQuizEvent({ id: id(2) })], {
            hasMore: false,
            nextOffset: null,
            offset,
          });
        }
        // Pages past the end are empty and must not contribute events.
        return appQuizEventsResponse([appQuizEvent({ id: id(99) })], {
          hasMore: false,
          nextOffset: null,
          offset,
        });
      });

      const events = await fetchAppQuizEvents('ogabassey');

      expect(events.map((event) => event.id)).toEqual([id(2)]);
    });

    it('requests a follow-up page only while the server reports more, bounded to four', async () => {
      apiGetMock.mockImplementation(async (url: string) => {
        const offset = offsetOf(url);
        return appQuizEventsResponse([], {
          hasMore: true,
          nextOffset: offset + 50,
          offset,
        });
      });

      await fetchAppQuizEvents('ogabassey');

      expect(apiGetMock.mock.calls.map(([url]) => offsetOf(url))).toEqual([
        0, 50, 100, 150,
      ]);
    });

    it('makes a single request when the first page is complete', async () => {
      apiGetMock.mockResolvedValue(appQuizEventsResponse([appQuizEvent()]));

      await fetchAppQuizEvents('ogabassey');

      expect(apiGetMock).toHaveBeenCalledTimes(1);
    });
  });

  it('rejects a response that is not the v2 contract', async () => {
    apiGetMock.mockResolvedValue({ events: [{ id: 'legacy' }] });

    await expect(fetchAppQuizEvents('ogabassey')).rejects.toThrow(
      'Invalid quiz response'
    );
  });
});
