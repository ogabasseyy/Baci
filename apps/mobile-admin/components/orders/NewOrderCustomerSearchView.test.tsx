import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NewOrderController } from '@/hooks/useNewOrderController';
import { NewOrderCustomerSearchView } from './NewOrderCustomerSearchView';

const styleHelpers = vi.hoisted(() => ({
  bodyLayoutHeight: 620,
  getStyleValue: (style: unknown, key: string) => {
    const styleEntries = Array.isArray(style) ? style : [style];
    const matchingStyle = styleEntries.find(
      (entry): entry is Record<string, unknown> =>
        Boolean(entry) && typeof entry === 'object' && key in entry
    );

    return matchingStyle?.[key];
  },
}));

vi.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: () => null,

  default: () => null,
  __esModule: true,
}));

vi.mock('@gorhom/bottom-sheet', () => ({
  BottomSheetFlatList: ({
    ListHeaderComponent,
    ListFooterComponent,
    ListEmptyComponent,
    contentContainerStyle,
    data,
    nestedScrollEnabled,
    onEndReached,
    onEndReachedThreshold,
    renderItem,
    style,
  }: {
    ListHeaderComponent?: React.ReactNode;
    ListFooterComponent?: React.ReactNode;
    ListEmptyComponent?: React.ReactNode;
    contentContainerStyle?: { paddingBottom?: number };
    data: unknown[];
    nestedScrollEnabled?: boolean;
    onEndReached?: (info: { distanceFromEnd: number }) => void;
    onEndReachedThreshold?: number;
    renderItem: (item: { item: unknown }) => React.ReactNode;
    style?: unknown;
  }) => (
    <div
      data-flex={styleHelpers.getStyleValue(style, 'flex')}
      data-min-height={styleHelpers.getStyleValue(style, 'minHeight')}
      data-nested-scroll-enabled={String(Boolean(nestedScrollEnabled))}
      data-on-end-reached-threshold={onEndReachedThreshold}
      data-testid="customer-bottom-sheet-list"
      data-padding-bottom={contentContainerStyle?.paddingBottom}
      onScroll={() => {
        onEndReached?.({ distanceFromEnd: 0 });
      }}
    >
      {ListHeaderComponent}
      {data.length === 0
        ? ListEmptyComponent
        : data.map((item, index) => (
            <div key={String(index)}>{renderItem({ item })}</div>
          ))}
      {ListFooterComponent}
    </div>
  ),
}));

vi.mock('react-native', async () => {
  const React = await import('react');

  return {
    StatusBar: () => null,
    Pressable: ({
      accessibilityLabel,
      children,
      onPress,
    }: {
      accessibilityLabel?: string;
      children?: React.ReactNode;
      onPress?: () => void;
    }) =>
      React.createElement(
        'button',
        {
          'aria-label': accessibilityLabel,
          onClick: () => onPress?.(),
          type: 'button',
        },
        children
      ),
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
    },
    Text: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('span', null, children),
    TextInput: ({
      onChangeText,
      placeholder,
      value,
    }: {
      onChangeText?: (value: string) => void;
      placeholder?: string;
      value?: string;
    }) =>
      React.createElement('input', {
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          onChangeText?.(event.target.value),
        placeholder,
        value: value ?? '',
      }),
    View: ({
      children,
      onLayout,
      style,
      testID,
    }: {
      children?: React.ReactNode;
      onLayout?: (event: {
        nativeEvent: { layout: { height: number } };
      }) => void;
      style?: unknown;
      testID?: string;
    }) => {
      React.useEffect(() => {
        onLayout?.({
          nativeEvent: { layout: { height: styleHelpers.bodyLayoutHeight } },
        });
      }, [onLayout]);

      return React.createElement(
        'div',
        {
          'data-flex': styleHelpers.getStyleValue(style, 'flex'),
          'data-height': styleHelpers.getStyleValue(style, 'height'),
          'data-min-height': styleHelpers.getStyleValue(style, 'minHeight'),
          'data-testid': testID,
        },
        children
      );
    },
  };
});

type CustomerSearchController = Pick<
  NewOrderController,
  | 'colors'
  | 'customerSearch'
  | 'customersData'
  | 'customersQuery'
  | 'handleSelectCustomer'
  | 'setCustomerSearch'
  | 'setIsCreatingCustomer'
>;
type CustomerSearchRow = NonNullable<
  CustomerSearchController['customersData']
>['pages'][number]['customers'][number];

function makeCustomersQuery(
  overrides: Partial<CustomerSearchController['customersQuery']> = {}
): CustomerSearchController['customersQuery'] {
  return {
    error: null,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isError: false,
    isFetchingNextPage: false,
    isLoading: false,
    ...overrides,
  } as CustomerSearchController['customersQuery'];
}

function makeController(
  overrides: Partial<CustomerSearchController> = {}
): NewOrderController {
  const customersQuery = makeCustomersQuery(overrides.customersQuery);

  return {
    colors: {
      border: '#e2e8f0',
      cardHover: '#f8fafc',
      primary: '#2563eb',
      success: '#16a34a',
      text: '#0f172a',
      textMuted: '#94a3b8',
      textSecondary: '#64748b',
      ...overrides.colors,
    },
    customerSearch: '',
    customersData: { pages: [] },
    handleSelectCustomer: vi.fn(),
    setCustomerSearch: vi.fn(),
    setIsCreatingCustomer: vi.fn(),
    ...overrides,
    customersQuery,
  } as NewOrderController;
}

function makeCustomer(
  overrides: Partial<CustomerSearchRow>
): CustomerSearchRow {
  return {
    address: null,
    city: null,
    company_name: null,
    country: null,
    country_code: null,
    created_at: '',
    deleted_at: null,
    email: null,
    first_name: null,
    full_name: null,
    id: 'customer-default',
    last_login_at: null,
    last_name: null,
    latitude: null,
    longitude: null,
    loyalty_points: 0,
    merchant_id: 'merchant-1',
    phone: null,
    state: null,
    store_credit: 0,
    total_orders: 0,
    total_spent: 0,
    updated_at: '',
    zip_code: null,
    ...overrides,
    customer_type: overrides.customer_type ?? 'individual',
  };
}

describe('NewOrderCustomerSearchView', () => {
  beforeEach(() => {
    styleHelpers.bodyLayoutHeight = 620;
  });

  it('shows the empty state and forwards search/create interactions', () => {
    const controller = makeController();

    render(<NewOrderCustomerSearchView controller={controller} />);

    expect(screen.getByText('No customers found')).toBeInTheDocument();

    fireEvent.change(
      screen.getByPlaceholderText('Search name, email, or phone...'),
      {
        target: { value: 'Ada' },
      }
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Create new customer' })
    );

    expect(controller.setCustomerSearch).toHaveBeenCalledWith('Ada');
    expect(controller.setIsCreatingCustomer).toHaveBeenCalledWith(true);
  });

  it('keeps the Gorhom list as the direct scroll region when the footer owns search input', () => {
    const controller = makeController();

    render(
      <NewOrderCustomerSearchView
        controller={controller}
        listBottomPadding={104}
        showInlineSearch={false}
      />
    );

    expect(
      screen.queryByPlaceholderText('Search name, email, or phone...')
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('customer-bottom-sheet-list')).toHaveAttribute(
      'data-padding-bottom',
      '104'
    );
    // The list must NOT set its own flex — gorhom sizes it inside the dedicated
    // height-bounded wrapper. Flex on the list itself leaves the viewport
    // unbounded (viewport == content height) and blocks scrolling.
    expect(
      screen.getByTestId('customer-bottom-sheet-list')
    ).not.toHaveAttribute('data-flex');
    expect(screen.getByTestId('customer-list-viewport')).toHaveAttribute(
      'data-height',
      '536'
    );
    // Must NOT enable native nested scroll — it overrides @gorhom/bottom-sheet's
    // drag↔scroll gesture coordination and makes the list spring back instead of
    // scrolling (the product picker omits it, which is why it scrolls correctly).
    expect(screen.getByTestId('customer-bottom-sheet-list')).toHaveAttribute(
      'data-nested-scroll-enabled',
      'false'
    );
    expect(
      within(screen.getByTestId('customer-bottom-sheet-list')).queryByRole(
        'button',
        { name: 'Create new customer' }
      )
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Create new customer' })
    ).toBeInTheDocument();
  });

  it('clamps the customer list viewport height on short sheet layouts', () => {
    styleHelpers.bodyLayoutHeight = 300;
    const controller = makeController();

    render(
      <NewOrderCustomerSearchView
        controller={controller}
        showInlineSearch={false}
      />
    );

    expect(screen.getByTestId('customer-list-viewport')).toHaveAttribute(
      'data-height',
      '260'
    );
  });

  it('preserves the server-provided (alpha-sorted) customer order across pages', () => {
    // The query requests `sortBy: 'alpha'`, so pages already arrive globally
    // ordered by name. The view must render them in that order without a
    // client-side re-sort, which would only reshuffle the loaded subset.
    const controller = makeController({
      customersData: {
        pageParams: [0, 1],
        pages: [
          {
            customers: [
              makeCustomer({
                email: 'adeyemih31@gmail.com',
                id: 'customer-adeyemi',
              }),
              makeCustomer({
                email: 'gbodiakinshola27@gmail.com',
                id: 'customer-gbodia',
              }),
            ],
            nextCursor: 1,
            totalCount: 3,
          },
          {
            customers: [
              makeCustomer({
                email: 'victoralaka9@gmail.com',
                id: 'customer-victor',
              }),
            ],
            nextCursor: null,
            totalCount: 3,
          },
        ],
      },
    });

    render(
      <NewOrderCustomerSearchView
        controller={controller}
        showInlineSearch={false}
      />
    );

    expect(
      screen
        .getAllByRole('button', { name: /^Select customer / })
        .map((button) => button.getAttribute('aria-label'))
    ).toEqual([
      'Select customer adeyemih31',
      'Select customer gbodiakinshola27',
      'Select customer victoralaka9',
    ]);
  });

  it('deduplicates customer rows across shifted pages without re-sorting them', () => {
    const controller = makeController({
      customersData: {
        pageParams: [0, 1],
        pages: [
          {
            customers: [
              makeCustomer({
                email: 'ada@example.com',
                id: 'customer-ada',
              }),
              makeCustomer({
                email: 'bassey@example.com',
                id: 'customer-bassey',
              }),
            ],
            nextCursor: 1,
            totalCount: 3,
          },
          {
            customers: [
              makeCustomer({
                email: 'bassey@example.com',
                id: 'customer-bassey',
              }),
              makeCustomer({
                email: 'chika@example.com',
                id: 'customer-chika',
              }),
            ],
            nextCursor: null,
            totalCount: 3,
          },
        ],
      },
    });

    render(
      <NewOrderCustomerSearchView
        controller={controller}
        showInlineSearch={false}
      />
    );

    expect(
      screen
        .getAllByRole('button', { name: /^Select customer / })
        .map((button) => button.getAttribute('aria-label'))
    ).toEqual([
      'Select customer ada',
      'Select customer bassey',
      'Select customer chika',
    ]);
  });

  it('renders customer rows with shared fallback display helpers', () => {
    const customerWithPhoneOnly = makeCustomer({
      id: 'customer-1',
      phone: '08012345678',
      total_orders: 2,
    });
    const controller = makeController({
      customersData: {
        pageParams: [0],
        pages: [
          {
            customers: [customerWithPhoneOnly],
            nextCursor: null,
            totalCount: 1,
          },
        ],
      },
    });

    render(<NewOrderCustomerSearchView controller={controller} />);

    expect(
      screen.getByRole('button', { name: 'Select customer 08012345678' })
    ).toBeInTheDocument();
    expect(screen.getAllByText('08012345678')).toHaveLength(2);
    expect(screen.getByText('2 orders')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Select customer 08012345678' })
    );

    expect(controller.handleSelectCustomer).toHaveBeenCalledWith(
      customerWithPhoneOnly
    );
  });

  it('fetches the next customer page automatically when the list reaches the end', () => {
    const customersQuery = makeCustomersQuery({
      fetchNextPage: vi.fn(),
      hasNextPage: true,
      isFetchingNextPage: false,
    });
    const controller = makeController({
      customersData: {
        pageParams: [0],
        pages: [{ customers: [], nextCursor: 20, totalCount: 20 }],
      },
      customersQuery,
    });

    render(<NewOrderCustomerSearchView controller={controller} />);

    expect(
      screen.queryByRole('button', { name: 'Load more customers' })
    ).not.toBeInTheDocument();
    fireEvent.scroll(screen.getByTestId('customer-bottom-sheet-list'));

    expect(customersQuery.fetchNextPage).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('customer-bottom-sheet-list')).toHaveAttribute(
      'data-on-end-reached-threshold',
      '0.5'
    );
  });

  it('shows the loading footer while fetching more customers', () => {
    const controller = makeController({
      customersData: {
        pageParams: [0],
        pages: [{ customers: [], nextCursor: 20, totalCount: 20 }],
      },
      customersQuery: makeCustomersQuery({
        fetchNextPage: vi.fn(),
        hasNextPage: true,
        isFetchingNextPage: true,
      }),
    });

    render(<NewOrderCustomerSearchView controller={controller} />);

    expect(screen.getByText('Loading more customers…')).toBeInTheDocument();
  });

  it('shows a loading empty state while customers are loading', () => {
    const controller = makeController({
      customersQuery: makeCustomersQuery({
        isLoading: true,
      }),
    });

    render(<NewOrderCustomerSearchView controller={controller} />);

    expect(screen.getByText('Loading customers...')).toBeInTheDocument();
  });

  it('shows an error empty state when the customer query fails', () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const controller = makeController({
      customersQuery: makeCustomersQuery({
        error: new Error('Customer fetch failed'),
        isError: true,
      }),
    });

    try {
      render(<NewOrderCustomerSearchView controller={controller} />);

      expect(screen.getByText('Failed to load customers')).toBeInTheDocument();
      expect(
        screen.queryByText('Customer fetch failed')
      ).not.toBeInTheDocument();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Customer search failed:',
        controller.customersQuery.error
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
