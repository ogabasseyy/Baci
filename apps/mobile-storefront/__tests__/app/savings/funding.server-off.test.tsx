import { render } from '@testing-library/react-native';
import { Redirect } from 'expo-router';
import { expectNoPiggyvestUi } from '@/test-support/piggyvest-server-off.test-support';
import SavingsPlanFundingRoute from '../../../app/savings/funding';

jest.mock('expo-router', () => ({ Redirect: jest.fn(() => null) }));

// Old links to the plan account screen land on the wallet whatever the server
// says: the route renders no plan account.
describe('server keeps PiggyVest off', () => {
  it('redirects to the wallet and shows no plan account', () => {
    render(<SavingsPlanFundingRoute />);
    expect(jest.mocked(Redirect).mock.calls[0]?.[0]).toEqual({
      href: '/wallet',
    });
    expectNoPiggyvestUi();
  });
});
