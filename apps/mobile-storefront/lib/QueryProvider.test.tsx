/**
 * Tests for QueryProvider — verifies deferred persistence hydration,
 * IsRestoringProvider state, and persistenceEnabled=false bypass.
 */

import { render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

const mockRestore = jest.fn().mockResolvedValue(undefined);
const mockSubscribe = jest.fn().mockReturnValue(jest.fn());

jest.mock('@tanstack/react-query-persist-client', () => ({
  persistQueryClientRestore: (...args: unknown[]) => mockRestore(...args),
  persistQueryClientSubscribe: (...args: unknown[]) => mockSubscribe(...args),
}));

jest.mock('./query-client', () => ({
  queryClient: {
    mount: jest.fn(),
    unmount: jest.fn(),
    getQueryCache: jest.fn(() => ({
      subscribe: jest.fn(() => jest.fn()),
      findAll: jest.fn(() => []),
      getAll: jest.fn(() => []),
    })),
    getMutationCache: jest.fn(() => ({
      subscribe: jest.fn(() => jest.fn()),
      findAll: jest.fn(() => []),
      getAll: jest.fn(() => []),
    })),
    getDefaultOptions: jest.fn(() => ({})),
    setDefaultOptions: jest.fn(),
    getQueryDefaults: jest.fn(() => undefined),
    getMutationDefaults: jest.fn(() => undefined),
  },
  queryPersister: {
    persistClient: jest.fn(),
    restoreClient: jest.fn(),
    removeClient: jest.fn(),
  },
}));

jest.mock('./logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

// Import after mocks
import { QueryProvider } from './QueryProvider';

function TestChild() {
  return <Text testID="child">Hello</Text>;
}

describe('QueryProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRestore.mockResolvedValue(undefined);
    mockSubscribe.mockReturnValue(jest.fn());
  });

  it('renders children', async () => {
    const { getByTestId } = render(
      <QueryProvider>
        <TestChild />
      </QueryProvider>
    );

    await waitFor(() => {
      expect(getByTestId('child')).toBeTruthy();
    });
  });

  it('calls persistQueryClientRestore on mount when persistenceEnabled=true', async () => {
    render(
      <QueryProvider persistenceEnabled={true}>
        <TestChild />
      </QueryProvider>
    );

    await waitFor(() => {
      expect(mockRestore).toHaveBeenCalledTimes(1);
    });
  });

  it('calls persistQueryClientSubscribe after restore completes', async () => {
    render(
      <QueryProvider persistenceEnabled={true}>
        <TestChild />
      </QueryProvider>
    );

    await waitFor(() => {
      expect(mockSubscribe).toHaveBeenCalledTimes(1);
    });
  });

  it('passes maxAge of 24 hours in persist options', async () => {
    render(
      <QueryProvider>
        <TestChild />
      </QueryProvider>
    );

    await waitFor(() => {
      expect(mockRestore).toHaveBeenCalledTimes(1);
    });

    const persistOptions = mockRestore.mock.calls[0][0];
    expect(persistOptions.maxAge).toBe(1000 * 60 * 60 * 24);
  });

  it('does not call restore or subscribe when persistenceEnabled=false', async () => {
    render(
      <QueryProvider persistenceEnabled={false}>
        <TestChild />
      </QueryProvider>
    );

    // Give effects time to run
    await waitFor(() => {
      expect(mockRestore).not.toHaveBeenCalled();
      expect(mockSubscribe).not.toHaveBeenCalled();
    });
  });

  it('unsubscribes on unmount', async () => {
    const unsubFn = jest.fn();
    mockSubscribe.mockReturnValue(unsubFn);

    const { unmount } = render(
      <QueryProvider>
        <TestChild />
      </QueryProvider>
    );

    await waitFor(() => {
      expect(mockSubscribe).toHaveBeenCalledTimes(1);
    });

    unmount();
    expect(unsubFn).toHaveBeenCalled();
  });

  it('handles restore failure gracefully and still subscribes', async () => {
    mockRestore.mockRejectedValueOnce(new Error('Storage corrupt'));

    render(
      <QueryProvider>
        <TestChild />
      </QueryProvider>
    );

    await waitFor(() => {
      expect(mockSubscribe).toHaveBeenCalledTimes(1);
    });
  });

  it('shouldDehydrateQuery only persists successful queries', async () => {
    render(
      <QueryProvider>
        <TestChild />
      </QueryProvider>
    );

    await waitFor(() => {
      expect(mockRestore).toHaveBeenCalledTimes(1);
    });

    const persistOptions = mockRestore.mock.calls[0][0];
    const shouldDehydrate =
      persistOptions.dehydrateOptions.shouldDehydrateQuery;

    expect(shouldDehydrate({ state: { status: 'success' } })).toBe(true);
    expect(shouldDehydrate({ state: { status: 'error' } })).toBe(false);
    expect(shouldDehydrate({ state: { status: 'pending' } })).toBe(false);
  });

  it('bugfix: restores through a persister that drops saved wallet activity', async () => {
    const { queryPersister } = jest.requireMock('./query-client') as {
      queryPersister: { restoreClient: jest.Mock };
    };
    queryPersister.restoreClient.mockResolvedValue({
      buster: '',
      timestamp: 0,
      clientState: {
        mutations: [],
        queries: [
          { queryKey: ['piggyvest-wallet-activity', 'm', 'u'] },
          { queryKey: ['products'] },
        ],
      },
    });
    render(
      <QueryProvider>
        <TestChild />
      </QueryProvider>
    );
    await waitFor(() => {
      expect(mockRestore).toHaveBeenCalledTimes(1);
    });

    const saved = await mockRestore.mock.calls[0][0].persister.restoreClient();

    expect(
      saved.clientState.queries.map((q: { queryKey: unknown[] }) => q.queryKey)
    ).toEqual([['products']]);
  });
});
