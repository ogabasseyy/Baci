import { render } from '@testing-library/react-native';
import SavingsPlanFundingRoute from '../../../app/savings/funding';

const mockRedirect = jest.fn();
jest.mock('expo-router', () => ({
  Redirect: (props: { href: string }) => {
    mockRedirect(props.href);
    return null;
  },
}));

describe('SavingsPlanFundingRoute', () => {
  beforeEach(() => {
    mockRedirect.mockClear();
  });

  it('sends old plan-funding links to the wallet without showing a plan account', () => {
    render(<SavingsPlanFundingRoute />);
    expect(mockRedirect).toHaveBeenCalledTimes(1);
    expect(mockRedirect).toHaveBeenCalledWith('/wallet');
  });
});
