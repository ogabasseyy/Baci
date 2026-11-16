import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { ImeiCheckServiceSelector } from './imei-check-service-selector';

jest.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: () => null,

  default: () => null,
  __esModule: true,
}));

const baseProps = {
  colors: Colors.light,
  displayedTierKeys: ['full', 'blacklist', 'carrier'] as const,
  selectedTier: 'full' as const,
  canToggleServices: true,
  showAllServices: false,
  onTierSelect: jest.fn(),
  onToggleServices: jest.fn(),
};

describe('ImeiCheckServiceSelector', () => {
  it('leads each card with one check and a red row naming the others', () => {
    render(
      <ImeiCheckServiceSelector
        {...baseProps}
        displayedTierKeys={['basic', 'appleBasic', 'serialInfo', 'blacklist']}
        selectedTier="basic"
      />
    );
    expect(screen.getByText('Device details')).toBeTruthy();
    expect(screen.getByText('3 options')).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.getByText('2 more options')).toBeTruthy();
    expect(screen.getByText('Apple Basic Info · Serial Info')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('More Device details options'));
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    expect(screen.getByText('Show fewer options')).toBeTruthy();
  });

  it('bugfix: with every check shown, no "more options" row repeats under each card (owner walk)', () => {
    render(
      <ImeiCheckServiceSelector
        {...baseProps}
        displayedTierKeys={['basic', 'appleBasic', 'blacklist', 'blacklistPro']}
        selectedTier="basic"
        showAllServices
      />
    );
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    expect(screen.queryByLabelText(/More .* options/)).toBeNull();
    expect(screen.queryByText(/more option/)).toBeNull();
  });

  it('bugfix: explains a check in an in-app sheet instead of an iOS alert', () => {
    const { Alert } =
      jest.requireActual<typeof import('react-native')>('react-native');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const onTierSelect = jest.fn();
    render(
      <ImeiCheckServiceSelector {...baseProps} onTierSelect={onTierSelect} />
    );

    fireEvent.press(screen.getByLabelText('What Stolen Check includes'));

    expect(alert).not.toHaveBeenCalled();
    expect(screen.getByRole('header', { name: 'Stolen Check' })).toBeTruthy();
    expect(screen.getByText('GSMA Database')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Choose Stolen Check'));
    expect(onTierSelect).toHaveBeenCalledWith('blacklist');
    expect(screen.queryByText('GSMA Database')).toBeNull();
  });

  it('renders the displayed tier cards', () => {
    render(<ImeiCheckServiceSelector {...baseProps} />);

    expect(screen.getByText('Full Report')).toBeTruthy();
    expect(screen.getByText('Stolen Check')).toBeTruthy();
    expect(screen.getByText('Network Check')).toBeTruthy();
  });

  it('calls onTierSelect when a tier card is pressed', () => {
    const onTierSelect = jest.fn();
    render(
      <ImeiCheckServiceSelector {...baseProps} onTierSelect={onTierSelect} />
    );

    fireEvent.press(screen.getByText('Stolen Check'));

    expect(onTierSelect).toHaveBeenCalledWith('blacklist');
  });

  it('toggles the expand/collapse copy via onToggleServices', () => {
    const onToggleServices = jest.fn();
    const { rerender } = render(
      <ImeiCheckServiceSelector
        {...baseProps}
        onToggleServices={onToggleServices}
      />
    );

    expect(screen.getByText('See all checks')).toBeTruthy();
    fireEvent.press(screen.getByText('See all checks'));
    expect(onToggleServices).toHaveBeenCalledTimes(1);

    rerender(
      <ImeiCheckServiceSelector
        {...baseProps}
        showAllServices
        onToggleServices={onToggleServices}
      />
    );
    expect(screen.getByText('Show popular checks only')).toBeTruthy();
  });

  it('hides the expand control when there are no additional tiers', () => {
    render(
      <ImeiCheckServiceSelector {...baseProps} canToggleServices={false} />
    );

    expect(screen.queryByText('See all checks')).toBeNull();
    expect(screen.queryByText('Show popular checks only')).toBeNull();
  });
});

it('keeps comparison order stable after selecting an alternative', () => {
  const keys = ['basic', 'appleBasic', 'serialInfo'] as const;
  const { rerender } = render(
    <ImeiCheckServiceSelector
      {...baseProps}
      displayedTierKeys={keys}
      selectedTier="basic"
    />
  );
  fireEvent.press(screen.getByLabelText('More Device details options'));
  const before = screen
    .getAllByRole('radio')
    .map((e) => e.props.accessibilityLabel);
  rerender(
    <ImeiCheckServiceSelector
      {...baseProps}
      displayedTierKeys={keys}
      selectedTier="appleBasic"
    />
  );
  expect(
    screen.getAllByRole('radio').map((e) => e.props.accessibilityLabel)
  ).toEqual(before);
});

it('names the folded checks for screen readers (Muse)', () => {
  render(
    <ImeiCheckServiceSelector
      {...baseProps}
      displayedTierKeys={['basic', 'appleBasic', 'serialInfo']}
      selectedTier="basic"
    />
  );
  expect(screen.getByLabelText('More Device details options')).toHaveProp(
    'accessibilityHint',
    'Apple Basic Info, Serial Info'
  );
});
