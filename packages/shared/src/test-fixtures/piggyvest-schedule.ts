import { piggyvestScheduleReviewSchemas as schemas } from '../contracts/piggyvest-schedule-review';

// Runner-agnostic mock: this fixture is imported by both Vitest and Jest
// suites, so it must not import either runner. The returned functions
// expose the small mock surface consumers use (mock.calls, mockClear,
// mockReturnValue, mockImplementation) plus the _isMockFunction marker
// both runners' called-times matchers check.
type FixtureMock<A extends unknown[], R> = ((...args: A) => R) & {
  mock: { calls: A[]; results: Array<{ type: 'return'; value: R }> };
  mockClear: () => FixtureMock<A, R>;
  mockReturnValue: (value: R) => FixtureMock<A, R>;
  mockImplementation: (impl: (...args: A) => R) => FixtureMock<A, R>;
  mockImplementationOnce: (impl: (...args: A) => R) => FixtureMock<A, R>;
  mockResolvedValue: (value: Awaited<R>) => FixtureMock<A, R>;
  mockResolvedValueOnce: (value: Awaited<R>) => FixtureMock<A, R>;
  mockRejectedValue: (error: unknown) => FixtureMock<A, R>;
  getMockName: () => string;
  _isMockFunction: true;
};

export function createFixtureMock<A extends unknown[], R>(
  impl: (...args: A) => R
): FixtureMock<A, R> {
  let current = impl;
  const onceQueue: Array<(...args: A) => R> = [];
  const mockFn = ((...args: A) => {
    mockFn.mock.calls.push(args);
    const once = onceQueue.shift();
    const value = (once ?? current)(...args);
    mockFn.mock.results.push({ type: 'return', value });
    return value;
  }) as FixtureMock<A, R>;
  mockFn.mock = { calls: [], results: [] };
  mockFn.mockClear = () => {
    mockFn.mock.calls.length = 0;
    mockFn.mock.results.length = 0;
    onceQueue.length = 0;
    return mockFn;
  };
  mockFn.mockReturnValue = (value: R) => {
    current = () => value;
    return mockFn;
  };
  mockFn.mockImplementation = (next: (...args: A) => R) => {
    current = next;
    return mockFn;
  };
  mockFn.mockImplementationOnce = (next: (...args: A) => R) => {
    onceQueue.push(next);
    return mockFn;
  };
  mockFn.mockResolvedValue = (value: Awaited<R>) => {
    current = () => Promise.resolve(value) as R;
    return mockFn;
  };
  mockFn.mockResolvedValueOnce = (value: Awaited<R>) => {
    onceQueue.push(() => Promise.resolve(value) as R);
    return mockFn;
  };
  mockFn.mockRejectedValue = (error: unknown) => {
    current = () => Promise.reject(error) as R;
    return mockFn;
  };
  mockFn.getMockName = () => 'fixtureMock';
  mockFn._isMockFunction = true;
  return mockFn;
}

export function scheduleJourneyFixture() {
  const goalId = '11111111-1111-4111-8111-111111111111';
  const source = {
    environment: 'staging',
    status: 'ready',
    sessionKey: 'session',
    goalId,
    policy: {
      status: 'draft',
      goalId,
      revisionId: goalId,
      device: { productName: 'Synthetic', variant: null, condition: 'New' },
      terms: {
        version: 'synthetic',
        hash: 'a'.repeat(64),
        text: '<b>Synthetic plain terms</b>',
      },
      consent: 'accepted',
    },
    eligibility: { status: 'blocked' },
    funding: { status: 'unavailable' },
    progress: { status: 'unavailable' },
  };
  let state: ReturnType<typeof schemas.state.parse> = {
    version: 0,
    status: 'paused',
    consentProposal: null,
  };
  const receipts = new Map<
    string,
    NonNullable<ReturnType<typeof schemas.snapshot.parse>['historical']>
  >();
  let lose = false;
  let invalidated = false;
  let sequence = 0;
  const snapshot = () =>
    schemas.snapshot.parse({
      goalId,
      status: 'available',
      revisionId: goalId,
      termsHash: 'a'.repeat(64),
      state,
      historical: null,
      dispatch: 'disabled',
      debitPermission: false,
    });
  const read = createFixtureMock(async (operationId?: string) => ({
    ...snapshot(),
    historical: receipts.get(operationId ?? '') ?? null,
  }));
  const submit = createFixtureMock(
    async (request: ReturnType<typeof schemas.request.parse>) => {
      await Promise.resolve();
      const command = request.command;
      if (command.expectedVersion !== state.version) throw new Error('Stale');
      state = {
        version: state.version + 1,
        status:
          !invalidated && command.action === 'request_resume'
            ? 'resume_proposed'
            : 'paused',
        consentProposal:
          !invalidated && command.action === 'request_resume'
            ? {
                operationId: request.operationId,
                revisionId: command.revisionId,
                termsHash: command.termsHash,
              }
            : null,
      };
      const receipt = schemas.receipt.parse({
        operationId: request.operationId,
        state,
        persisted: true,
        dispatch: 'disabled',
        debitPermission: false,
      });
      receipts.set(request.operationId, { command, receipt });
      if (lose) {
        lose = false;
        throw new Error('Private lost ACK');
      }
      return schemas.result.parse({
        goalId,
        status: 'persisted_proposal',
        receipt,
        dispatch: 'disabled',
        debitPermission: false,
      });
    }
  );
  return {
    goalId,
    source,
    snapshot,
    read,
    submit,
    loseAcknowledgement() {
      lose = true;
    },
    invalidateProposal() {
      invalidated = true;
    },
    options: {
      source,
      tenantKey: 'tenant',
      read,
      submit,
      isCurrent: createFixtureMock(() => true),
      nextOperationId: createFixtureMock(
        () => `22222222-2222-4222-8222-${String(++sequence).padStart(12, '0')}`
      ),
    },
  };
}
