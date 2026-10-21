// Runner-agnostic fixture mock: imported by both Vitest and Jest
// suites through shared fixtures, so it must not import either
// runner. See createFixtureMock below for the exposed surface.
export type FixtureMock<A extends unknown[], R> = ((...args: A) => R) & {
  mock: {
    calls: A[];
    results: Array<{ type: 'return' | 'throw'; value: unknown }>;
    invocationCallOrder: number[];
  };
  mockClear: () => FixtureMock<A, R>;
  mockReturnValue: (value: R) => FixtureMock<A, R>;
  mockImplementation: (impl: (...args: A) => R) => FixtureMock<A, R>;
  mockImplementationOnce: (impl: (...args: A) => R) => FixtureMock<A, R>;
  mockResolvedValue: (value: Awaited<R>) => FixtureMock<A, R>;
  mockResolvedValueOnce: (value: Awaited<R>) => FixtureMock<A, R>;
  mockRejectedValue: (error: unknown) => FixtureMock<A, R>;
  mockRejectedValueOnce: (error: unknown) => FixtureMock<A, R>;
  mockReturnValueOnce: (value: R) => FixtureMock<A, R>;
  mockReset: () => FixtureMock<A, R>;
  getMockName: () => string;
  _isMockFunction: true;
};

let invocationSequence = 0;

export function createFixtureMock<A extends unknown[], R>(
  impl: (...args: A) => R
): FixtureMock<A, R> {
  let current = impl;
  const onceQueue: Array<(...args: A) => R> = [];
  const mockFn = ((...args: A) => {
    mockFn.mock.calls.push(args);
    mockFn.mock.invocationCallOrder.push(++invocationSequence);
    const once = onceQueue.shift();
    try {
      const value = (once ?? current)(...args);
      mockFn.mock.results.push({ type: 'return', value });
      return value;
    } catch (error) {
      mockFn.mock.results.push({ type: 'throw', value: error });
      throw error;
    }
  }) as FixtureMock<A, R>;
  mockFn.mock = { calls: [], results: [], invocationCallOrder: [] };
  // Runner-faithful: mockClear resets only calls/results/order (Jest and
  // Vitest semantics); queued once-implementations survive it. mockReset
  // additionally drops the once-queue and the installed implementation,
  // so post-reset calls return undefined exactly as Jest/Vitest
  // mockReset does — including for async mocks, whose post-reset calls
  // therefore return undefined rather than a promise and must only be
  // awaited, never chained with .then/.catch.
  mockFn.mockClear = () => {
    mockFn.mock.calls.length = 0;
    mockFn.mock.results.length = 0;
    mockFn.mock.invocationCallOrder.length = 0;
    return mockFn;
  };
  mockFn.mockReset = () => {
    mockFn.mockClear();
    onceQueue.length = 0;
    current = () => undefined as R;
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
  mockFn.mockRejectedValueOnce = (error: unknown) => {
    onceQueue.push(() => Promise.reject(error) as R);
    return mockFn;
  };
  mockFn.mockReturnValueOnce = (value: R) => {
    onceQueue.push(() => value);
    return mockFn;
  };
  mockFn.getMockName = () => 'fixtureMock';
  mockFn._isMockFunction = true;
  return mockFn;
}
