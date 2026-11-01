import { quizV2EventsResponseSchema } from '@baci/shared/schemas';
import { describe, expect, it } from 'vitest';
import { appQuizEvent, appQuizEventsResponse } from './app-quiz-event.test-support';

describe('app quiz event fixtures', () => {
  it('produce a response the strict v2 contract accepts', () => {
    const result = quizV2EventsResponseSchema.safeParse(
      appQuizEventsResponse([appQuizEvent()])
    );

    expect(result.success).toBe(true);
  });

  it('apply overrides', () => {
    expect(appQuizEvent({ title: 'Other' }).title).toBe('Other');
  });
});
