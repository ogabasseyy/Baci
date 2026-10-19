import { fireEvent, render, screen } from '@testing-library/react-native';
import { SearchDropdown } from './SearchDropdown';

const mockPush = jest.fn();
const mockUseProducts = jest.fn();
const mockUseCategories = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/hooks', () => ({
  useCategories: () => mockUseCategories(),
  useDebounce: (value: string) => value,
  useProducts: (args: unknown) => mockUseProducts(args),
}));

jest.mock('@/hooks/use-search-storage', () => ({
  useSearchStorage: () => ({
    clearHistory: jest.fn(),
    recentSearches: [],
    saveSearch: jest.fn(),
  }),
}));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

jest.mock('@/components/ui/SafeImage', () => ({
  SafeImage: () => null,
}));

describe('SearchDropdown', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseProducts.mockReturnValue({ isLoading: false, products: [] });
    mockUseCategories.mockReturnValue({ data: [] });
  });

  it('renders nothing when hidden', () => {
    const { queryByLabelText } = render(
      <SearchDropdown isVisible={false} onClose={() => {}} topOffset={72} />
    );

    expect(queryByLabelText('Close search')).toBeNull();
  });

  it('disables the product query while hidden even with a retained query', () => {
    // Hooks run before the visibility early-return: after a home submit the
    // dropdown stays mounted behind /search with its query retained, so the
    // query itself must be gated to stop fetching/observing there.
    render(
      <SearchDropdown
        isVisible={false}
        onClose={() => {}}
        onQueryChange={() => {}}
        query="iphone"
        topOffset={72}
      />
    );

    expect(mockUseProducts).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'iphone', enabled: false })
    );
  });

  it('enables the product query while visible', () => {
    render(
      <SearchDropdown
        isVisible
        onClose={() => {}}
        onQueryChange={() => {}}
        query="iphone"
        topOffset={72}
      />
    );

    expect(mockUseProducts).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'iphone', enabled: true })
    );
  });

  it('renders search controls when visible', () => {
    render(<SearchDropdown isVisible onClose={() => {}} topOffset={72} />);

    expect(screen.getByPlaceholderText('Search products…')).toBeTruthy();
    expect(screen.getByLabelText('Cancel search')).toBeTruthy();
  });

  it('calls onClose when scrim is pressed', () => {
    const onClose = jest.fn();

    render(<SearchDropdown isVisible onClose={onClose} topOffset={72} />);

    fireEvent.press(screen.getByLabelText('Close search'));
    expect(onClose).toHaveBeenCalled();
  });

  it('submits the current input through "See all results"', () => {
    const onSeeAllResults = jest.fn();
    mockUseProducts.mockReturnValue({
      isLoading: false,
      products: [
        {
          id: 'product-1',
          slug: 'iphone-16',
          name: 'iPhone 16',
          price: 900000,
          image: '',
          brand: 'Apple',
        },
      ],
    });

    render(
      <SearchDropdown
        isVisible
        onClose={() => {}}
        topOffset={72}
        hideInput
        query="iphone"
        onQueryChange={() => {}}
        onSeeAllResults={onSeeAllResults}
      />
    );

    fireEvent.press(screen.getByLabelText('See all results for iphone'));
    expect(onSeeAllResults).toHaveBeenCalledTimes(1);
    expect(onSeeAllResults).toHaveBeenCalledWith('iphone');
  });

  it('shows "See all results" in the no-suggestion state', () => {
    const onSeeAllResults = jest.fn();

    render(
      <SearchDropdown
        isVisible
        onClose={() => {}}
        topOffset={72}
        hideInput
        query="zzzz"
        onQueryChange={() => {}}
        onSeeAllResults={onSeeAllResults}
      />
    );

    expect(screen.getByText('No results for "zzzz"')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('See all results for zzzz'));
    expect(onSeeAllResults).toHaveBeenCalledWith('zzzz');
  });

  it('hides "See all results" without a submit handler', () => {
    mockUseProducts.mockReturnValue({
      isLoading: false,
      products: [
        {
          id: 'product-1',
          slug: 'iphone-16',
          name: 'iPhone 16',
          price: 900000,
          image: '',
          brand: 'Apple',
        },
      ],
    });

    render(
      <SearchDropdown
        isVisible
        onClose={() => {}}
        topOffset={72}
        hideInput
        query="iphone"
        onQueryChange={() => {}}
      />
    );

    expect(screen.queryByLabelText(/see all results/i)).toBeNull();
  });

  it('hides "See all results" for short queries', () => {
    render(
      <SearchDropdown
        isVisible
        onClose={() => {}}
        topOffset={72}
        hideInput
        query="i"
        onQueryChange={() => {}}
        onSeeAllResults={() => {}}
      />
    );

    expect(screen.queryByLabelText(/see all results/i)).toBeNull();
  });

  it('keeps product taps as direct-product shortcuts', () => {
    const onClose = jest.fn();
    mockUseProducts.mockReturnValue({
      isLoading: false,
      products: [
        {
          id: 'product-1',
          slug: 'iphone-16',
          name: 'iPhone 16',
          price: 900000,
          image: '',
          brand: 'Apple',
        },
      ],
    });

    render(
      <SearchDropdown
        isVisible
        onClose={onClose}
        topOffset={72}
        hideInput
        query="iphone"
        onQueryChange={() => {}}
        onSeeAllResults={() => {}}
      />
    );

    fireEvent.press(screen.getByLabelText(/iPhone 16/));
    expect(mockPush).toHaveBeenCalledWith('/product/iphone-16');
    expect(onClose).toHaveBeenCalled();
  });

  it('routes standalone input submit to the submit handler', () => {
    const onSeeAllResults = jest.fn();

    render(
      <SearchDropdown
        isVisible
        onClose={() => {}}
        topOffset={72}
        onSeeAllResults={onSeeAllResults}
      />
    );

    const input = screen.getByPlaceholderText('Search products…');
    fireEvent.changeText(input, 'iphone');
    fireEvent(input, 'submitEditing');

    expect(onSeeAllResults).toHaveBeenCalledTimes(1);
    expect(onSeeAllResults).toHaveBeenCalledWith('iphone');
  });
});
