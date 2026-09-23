import { jest } from '@jest/globals';
import type { QuizV2Attempt } from '@/services/quiz-types';
import {
  initialQuizV2State,
  type QuizRecoveryEnvelope,
  type V2StartContext,
} from './quiz-recovery-envelope';
import {
  activeAttempt,
  cancelledAttempt,
  createHarness,
  mockClearRecoveredQuizAttempt,
  mockLoadRecoveryEnvelope,
  mockPersist,
  mockSaveQuizStartRequest,
  resetQuizV2StoreActionMocks,
} from './quiz-v2-store-actions.test-support';

describe('createQuizV2StoreActions terminal expiry', () => {
  beforeEach(() => {
    resetQuizV2StoreActionMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('still starts when recovery storage rejects the start envelope', async () => {
    mockSaveQuizStartRequest.mockRejectedValueOnce(new Error('storage full'));
    const harness = createHarness();
    const starter = jest.fn(async () => activeAttempt);

    await harness.actions.startEventV2(
      {
        eventId: 'event-1',
        integrityTier: 'strong',
        startRequestId: '44444444-4444-4444-8444-444444444444',
        userId: 'user-1',
      },
      starter
    );

    expect(mockSaveQuizStartRequest).toHaveBeenCalledTimes(1);
    expect(starter).toHaveBeenCalledWith(
      '44444444-4444-4444-8444-444444444444'
    );
    expect(harness.getState()).toMatchObject({
      status: 'question',
      v2Attempt: activeAttempt,
    });
  });

  it('keeps the started attempt visible when persistence rejects after start', async () => {
    mockPersist.mockRejectedValueOnce(new Error('storage full'));
    const harness = createHarness();
    const starter = jest.fn(async () => activeAttempt);

    await harness.actions.startEventV2(
      {
        eventId: 'event-1',
        integrityTier: 'strong',
        startRequestId: '77777777-7777-4777-8777-777777777777',
        userId: 'user-1',
      },
      starter
    );

    expect(starter).toHaveBeenCalledTimes(1);
    expect(harness.getState()).toMatchObject({
      status: 'question',
      v2Attempt: activeAttempt,
    });
  });

  it('keeps cancellation terminal when recovery cleanup rejects', async () => {
    mockClearRecoveredQuizAttempt.mockRejectedValueOnce(
      new Error('storage unavailable')
    );
    const harness = createHarness();

    await harness.actions.lockAndSubmitAnswer(
      'a',
      jest.fn(async () => cancelledAttempt)
    );

    expect(harness.getState()).toMatchObject({
      status: 'result',
      v2Attempt: null,
      v2LifecycleStatus: 'event_cancelled',
    });
    expect(mockClearRecoveredQuizAttempt).toHaveBeenCalledWith(
      expect.anything(),
      'event-1'
    );
  });

  it('starts with the requested id when recovery storage cannot be read', async () => {
    mockLoadRecoveryEnvelope.mockRejectedValueOnce(
      new Error('storage unavailable')
    );
    const harness = createHarness();
    const starter = jest.fn(async () => activeAttempt);

    await harness.actions.startEventV2(
      {
        eventId: 'event-1',
        integrityTier: 'strong',
        startRequestId: '66666666-6666-4666-8666-666666666666',
        userId: 'user-1',
      },
      starter
    );

    expect(starter).toHaveBeenCalledWith(
      '66666666-6666-4666-8666-666666666666'
    );
    expect(harness.getState()).toMatchObject({
      status: 'question',
      v2Attempt: activeAttempt,
    });
  });

  it('uses a fresh start request id after retaining a completed attempt', async () => {
    const harness = createHarness();
    const retained: QuizRecoveryEnvelope = {
      attemptId: 'attempt-1',
      currentQuestionId: null,
      eventId: 'event-1',
      generation: 0,
      pendingLockedOptionId: null,
      persistedAt: '2026-08-04T12:00:20.000Z',
      startRequestId: '11111111-1111-4111-8111-111111111111',
      userId: 'user-1',
      version: 1,
    };
    mockLoadRecoveryEnvelope.mockResolvedValueOnce(retained);
    const context: V2StartContext = {
      eventId: 'event-1',
      integrityTier: 'strong',
      startRequestId: '22222222-2222-4222-8222-222222222222',
      userId: 'user-1',
    };
    const starter = jest.fn(async () => activeAttempt);

    await harness.actions.startEventV2(context, starter);

    expect(starter).toHaveBeenCalledWith(context.startRequestId);
    expect(mockSaveQuizStartRequest).toHaveBeenCalledWith(
      context,
      0,
      context.startRequestId
    );
  });

  it('serializes concurrent starts before recovery storage resolves', async () => {
    const harness = createHarness();
    harness.set({ status: 'ready', v2Attempt: null });
    let resolveLoad!: (value: null) => void;
    mockLoadRecoveryEnvelope.mockReturnValueOnce(
      new Promise<null>((resolve) => {
        resolveLoad = resolve;
      })
    );
    const starter = jest.fn(async () => activeAttempt);
    const context: V2StartContext = {
      eventId: 'event-1',
      integrityTier: 'strong',
      startRequestId: '55555555-5555-4555-8555-555555555555',
      userId: 'user-1',
    };

    const firstStart = harness.actions.startEventV2(context, starter);
    const secondStart = harness.actions.startEventV2(context, starter);
    expect(starter).not.toHaveBeenCalled();

    resolveLoad(null);
    await Promise.all([firstStart, secondStart]);

    expect(starter).toHaveBeenCalledTimes(1);
  });

  it('releases the start mutex when the account generation changes', async () => {
    const harness = createHarness();
    harness.set({ status: 'ready', v2Attempt: null });
    let resolveFirstLoad!: (value: null) => void;
    mockLoadRecoveryEnvelope.mockReturnValueOnce(
      new Promise<null>((resolve) => {
        resolveFirstLoad = resolve;
      })
    );
    const first = harness.actions.startEventV2(
      {
        eventId: 'event-1',
        integrityTier: 'strong',
        startRequestId: '55555555-5555-4555-8555-555555555555',
        userId: 'user-1',
      },
      jest.fn(async () => activeAttempt)
    );

    for (let attempts = 0; attempts < 10 && !resolveFirstLoad; attempts += 1)
      await Promise.resolve();
    if (!resolveFirstLoad) throw new Error('first start did not begin');

    harness.setGeneration(1);
    harness.set({ ...initialQuizV2State, status: 'ready' });
    const secondStarter = jest.fn(async () => activeAttempt);
    const second = harness.actions.startEventV2(
      {
        eventId: 'event-2',
        integrityTier: 'strong',
        startRequestId: '66666666-6666-4666-8666-666666666666',
        userId: 'user-2',
      },
      secondStarter
    );

    await second;
    expect(secondStarter).toHaveBeenCalledTimes(1);

    resolveFirstLoad(null);
    await first;
  });

  it('does not overwrite the new account state after recovery storage resolves', async () => {
    const harness = createHarness();
    let resolveLoad!: (value: null) => void;
    const load = new Promise<null>((resolve) => {
      resolveLoad = resolve;
    });
    const starter = jest.fn(async () => activeAttempt);
    mockLoadRecoveryEnvelope.mockReturnValueOnce(load);

    const start = harness.actions.startEventV2(
      {
        eventId: 'event-1',
        integrityTier: 'strong',
        startRequestId: '33333333-3333-4333-8333-333333333333',
        userId: 'user-1',
      },
      starter
    );
    harness.setGeneration(1);
    const replacement = {
      status: 'question' as const,
      startRequestId: 'new-request',
      selectedEventId: 'new-event',
      attemptIntegrityTier: 'basic' as const,
      recoveryUserId: 'new-user',
    };
    harness.set(replacement);
    resolveLoad(null);
    await start;

    expect(starter).not.toHaveBeenCalled();
    expect(harness.getState()).toMatchObject(replacement);
  });

  it('still submits when recovery storage rejects', async () => {
    mockPersist.mockRejectedValueOnce(new Error('storage full'));
    const harness = createHarness();
    const submitter = jest.fn(async () => activeAttempt);

    await harness.actions.lockAndSubmitAnswer('a', submitter);

    expect(submitter).toHaveBeenCalledWith('a');
    expect(harness.getState()).toMatchObject({
      lockedOptionId: null,
      status: 'question',
    });
  });

  it('persists a terminal envelope after the final answer', async () => {
    const harness = createHarness();
    const terminalAttempt: QuizV2Attempt = {
      ...activeAttempt,
      question: undefined,
      status: 'submitted_pending_results',
    };

    await harness.actions.lockAndSubmitAnswer(
      'a',
      jest.fn(async () => terminalAttempt)
    );

    expect(mockPersist).toHaveBeenNthCalledWith(1, activeAttempt, 'a');
    expect(mockPersist).toHaveBeenNthCalledWith(2, terminalAttempt, null);
  });
});
