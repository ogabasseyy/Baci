import { createQuizV2LifecycleHandlers } from './create-quiz-v2-lifecycle-handlers';

describe('createQuizV2LifecycleHandlers', () => {
  it('does nothing when there is no active attempt', () => {
    const expire = jest.fn();
    const retry = jest.fn();
    const handlers = createQuizV2LifecycleHandlers({
      attempt: null,
      expire,
      lockedOptionId: null,
      retry,
      userId: 'user-1',
    });
    handlers.handleExpire();
    handlers.handleRetry();
    expect(expire).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
  });
});
