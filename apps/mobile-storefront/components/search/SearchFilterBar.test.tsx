import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SearchFilterBar } from './SearchFilterBar';

const props = {
  categories: ['All', 'Phones'],
  selectedCategory: 'All',
  onSelectCategory: jest.fn(),
  minPrice: 0,
  maxPrice: 3000000,
  onPriceChange: jest.fn(),
  brands: ['Apple', 'Samsung'],
  onBrandFilterVisible: jest.fn(),
  selectedBrand: 'All',
  onSelectBrand: jest.fn(),
  selectedCondition: 'All',
  onSelectCondition: jest.fn(),
  minRating: 0,
  onSelectRating: jest.fn(),
  viewMode: 'grid' as const,
  onViewModeChange: jest.fn(),
};

describe('Search filter sheets', () => {
  beforeEach(() => jest.clearAllMocks());
  it('opens brand options, selects the brand and closes with Done', () => {
    render(<SearchFilterBar {...props} />);
    fireEvent.press(screen.getByRole('button', { name: 'Brand' }));
    expect(props.onBrandFilterVisible).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByRole('button', { name: 'Apple' }));
    expect(props.onSelectBrand).toHaveBeenCalledWith('Apple');
    fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('button', { name: 'Apple' })).toBeNull();
  });
  it('opens condition options and preserves selection', () => {
    render(<SearchFilterBar {...props} selectedCondition="Used" />);
    fireEvent.press(screen.getByRole('button', { name: 'Condition' }));
    expect(
      screen.getByRole('button', { name: 'Used' }).props.accessibilityState
        .selected
    ).toBe(true);
    fireEvent.press(screen.getByRole('button', { name: 'New' }));
    expect(props.onSelectCondition).toHaveBeenCalledWith('New');
    fireEvent.press(screen.getByRole('button', { name: 'Close filters' }));
    expect(screen.queryByRole('button', { name: 'New' })).toBeNull();
  });
  it('opens keyboard-aware price inputs and delegates the price change', () => {
    render(<SearchFilterBar {...props} />);
    fireEvent.press(screen.getByRole('button', { name: 'Price' }));
    fireEvent.changeText(screen.getByLabelText('Min'), '50000');
    fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(props.onPriceChange).toHaveBeenCalledWith(50000, 3000000);
  });
  it('preserves category, rating and view controls', () => {
    render(<SearchFilterBar {...props} />);
    fireEvent.press(screen.getByRole('button', { name: 'Phones category' }));
    expect(props.onSelectCategory).toHaveBeenCalledWith('Phones');
    fireEvent.press(screen.getByRole('button', { name: 'List view' }));
    expect(props.onViewModeChange).toHaveBeenCalledWith('list');
    fireEvent.press(screen.getByRole('button', { name: 'Rating' }));
    fireEvent.press(screen.getByRole('button', { name: '4+' }));
    expect(props.onSelectRating).toHaveBeenCalledWith(4);
  });
  it.each([
    'close-button',
    'pan-down',
    'hardware-back',
  ])('commits a focused price draft on %s dismissal', (path) => {
    render(<SearchFilterBar {...props} />);
    fireEvent.press(screen.getByRole('button', { name: 'Price' }));
    fireEvent.changeText(screen.getByLabelText('Min'), '75000');
    if (path === 'close-button')
      fireEvent.press(screen.getByRole('button', { name: 'Close filters' }));
    if (path === 'pan-down')
      fireEvent(screen.getByTestId('mock-bottom-sheet'), 'close');
    if (path === 'hardware-back')
      fireEvent(screen.getByTestId('draggable-sheet-modal'), 'requestClose');
    expect(props.onPriceChange).toHaveBeenCalledWith(75000, 3000000);
    expect(screen.queryByLabelText('Min')).toBeNull();
  });
  it('commits price on backdrop dismissal and configures sheet gestures and keyboard handling', () => {
    render(<SearchFilterBar {...props} />);
    fireEvent.press(screen.getByRole('button', { name: 'Price' }));
    fireEvent.changeText(screen.getByLabelText('Max'), '900000');
    const sheet = screen.getByTestId('mock-bottom-sheet');
    expect(sheet.props.snapPoints).toEqual(['45%', '80%']);
    expect(sheet.props.enablePanDownToClose).toBe(true);
    expect(sheet.props.keyboardBehavior).toBe('interactive');
    expect(sheet.props.android_keyboardInputMode).toBe('adjustResize');
    const backdrop = sheet.props.backdropComponent({});
    expect(backdrop.props.pressBehavior).toBe('close');
    act(() => backdrop.props.onPress());
    expect(props.onPriceChange).toHaveBeenCalledWith(0, 900000);
    expect(screen.queryByLabelText('Max')).toBeNull();
  });
});
