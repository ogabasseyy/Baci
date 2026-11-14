import { render, screen } from '@testing-library/react-native';
import { PiggyvestSavingsScreen } from './PiggyvestSavingsScreen';
import { fixture } from './PiggyvestSavingsScreen.fixture';

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

// Without an explicit staging verdict (none, unavailable, or a production
// environment) the screen reveals no device, consent box or account number.
describe('server keeps PiggyVest off', () => {
  function expectNothingRevealed() {
    expect(screen.queryByText('0000000000')).toBeNull();
    expect(screen.queryByText('Synthetic phone')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  }

  it('reveals nothing without a staging source', () => {
    render(<PiggyvestSavingsScreen staging={null} />);
    expectNothingRevealed();
    expect(screen.getByText('Draft policy review')).toBeOnTheScreen();
  });

  it('reveals nothing when the server marks the source unavailable', () => {
    render(
      <PiggyvestSavingsScreen
        staging={{
          ...fixture(),
          source: { environment: 'staging', status: 'unavailable' },
        }}
      />
    );
    expectNothingRevealed();
    expect(screen.getByText('Draft policy review')).toBeOnTheScreen();
  });

  it('reveals nothing for a production environment', () => {
    render(
      <PiggyvestSavingsScreen
        staging={{ ...fixture(), environment: 'production' } as never}
      />
    );
    expectNothingRevealed();
    expect(screen.getByText('Draft policy review')).toBeOnTheScreen();
  });
});
