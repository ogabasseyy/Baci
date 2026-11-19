import { render, screen } from '@testing-library/react-native';
import { PiggyvestSavingsScreen } from './PiggyvestSavingsScreen';
import { fixture, goalId } from './PiggyvestSavingsScreen.fixture';

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

// The fixture is a staging-only example. A declined consent (the fixture's
// default) never reveals the example's account number.
describe('server keeps PiggyVest off', () => {
  it('is bound to the staging environment and the fixture goal', () => {
    const input = fixture();
    expect(input.environment).toBe('staging');
    expect(input.goalId).toBe(goalId);
  });

  it('reveals no account number before consent is accepted', () => {
    render(<PiggyvestSavingsScreen staging={fixture()} />);
    expect(screen.queryByText('0000000000')).toBeNull();
  });
});
