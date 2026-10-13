import { act } from '@testing-library/react-native';
import { useQuizStore } from './quiz-store';
import { createDeferred, events } from './quiz-store.test-utils';

describe('useQuizStore event loading', () => {
  beforeEach(() => {
    useQuizStore.getState().reset();
  });

  it('drops a stale event response after an account change', async () => {
    const firstEvents = createDeferred<typeof events>();
    const secondEvents = createDeferred<typeof events>();

    const firstLoad = useQuizStore
      .getState()
      .loadEvents(() => firstEvents.promise);

    act(() => {
      useQuizStore.getState().resetForAccountChange();
    });

    const secondLoad = useQuizStore
      .getState()
      .loadEvents(() => secondEvents.promise);
    secondEvents.resolve([{ ...events[0], id: 'event-account-b' }]);
    await secondLoad;

    firstEvents.resolve(events);
    await firstLoad;

    expect(useQuizStore.getState()).toMatchObject({
      status: 'ready',
      events: [{ ...events[0], id: 'event-account-b' }],
    });
  });
});
