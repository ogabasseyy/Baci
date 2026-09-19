import { fireEvent, render, screen } from '@testing-library/react-native';
import { SearchOverlay } from './SearchOverlay';

jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({ push: jest.fn() })),
  useIsFocused: () => true,
}));

jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RN = require('react-native');
  return {
    __esModule: true,
    default: {
      View: RN.View,
      ScrollView: RN.ScrollView,
      createAnimatedComponent: (c: unknown) => c,
    },
    FadeIn: { delay: () => ({}) },
    FadeOut: {},
    SlideInUp: { duration: () => ({}) },
    SlideOutDown: { duration: () => ({}) },
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

const mockClearHistory = jest.fn();
const mockSaveSearch = jest.fn();

jest.mock('@/hooks/use-search-storage', () => ({
  useSearchStorage: () => ({
    recentSearches: ['shoes', 'bags'],
    saveSearch: mockSaveSearch,
    clearHistory: mockClearHistory,
  }),
}));

jest.mock('@/hooks', () => ({
  useProducts: () => ({ products: [], isLoading: false }),
  useCategories: () => ({ data: [] }),
  useDebounce: (v: unknown) => v,
}));

const mockOnClose = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
});

describe('SearchOverlay', () => {
  it('renders accessible Clear recent searches button', () => {
    render(<SearchOverlay isVisible onClose={mockOnClose} />);

    const clearButton = screen.getByRole('button', {
      name: /Clear recent searches/i,
    });
    expect(clearButton).toBeTruthy();
  });

  it('calls clearHistory when Clear button is pressed', () => {
    render(<SearchOverlay isVisible onClose={mockOnClose} />);

    const clearButton = screen.getByRole('button', {
      name: /Clear recent searches/i,
    });
    fireEvent.press(clearButton);
    expect(mockClearHistory).toHaveBeenCalledTimes(1);
  });

  it('renders accessible Cancel search button', () => {
    render(<SearchOverlay isVisible onClose={mockOnClose} />);

    const cancelButton = screen.getByRole('button', {
      name: /Cancel search/i,
    });
    expect(cancelButton).toBeTruthy();
  });

  it('calls onClose when Cancel is pressed', () => {
    render(<SearchOverlay isVisible onClose={mockOnClose} />);

    const cancelButton = screen.getByRole('button', {
      name: /Cancel search/i,
    });
    fireEvent.press(cancelButton);
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('renders recent search suggestions as accessible buttons', () => {
    render(<SearchOverlay isVisible onClose={mockOnClose} />);

    const shoesButton = screen.getByRole('button', {
      name: /Search for shoes/i,
    });
    const bagsButton = screen.getByRole('button', {
      name: /Search for bags/i,
    });
    expect(shoesButton).toBeTruthy();
    expect(bagsButton).toBeTruthy();
  });

  it('does not expose backdrop as an accessible button', () => {
    render(<SearchOverlay isVisible onClose={mockOnClose} />);

    const closeSearchButtons = screen.queryAllByRole('button', {
      name: /Close search/i,
    });
    expect(closeSearchButtons).toHaveLength(0);
  });

  it('returns null when not visible', () => {
    const { toJSON } = render(
      <SearchOverlay isVisible={false} onClose={mockOnClose} />
    );
    expect(toJSON()).toBeNull();
  });
});
