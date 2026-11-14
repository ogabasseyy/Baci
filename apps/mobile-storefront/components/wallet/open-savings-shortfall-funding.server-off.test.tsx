import { describe, expect, it, jest } from '@jest/globals';
import {
  createOpenSavingsShortfallFunding,
  SAVINGS_SHORTFALL_RETURN_TO,
} from './open-savings-shortfall-funding';

// The shortfall callback only runs when the wallet screen offers Add money
// for a ready PiggyVest wallet; with the server off it is never invoked and
// creating it changes nothing.
describe('savings shortfall funding with the server off', () => {
  it('does nothing until it is invoked', () => {
    const actions = {
      setFundReturnTo: jest.fn(),
      setShowFundPanel: jest.fn(),
      setShowSavingsProgressModal: jest.fn(),
    };
    createOpenSavingsShortfallFunding(actions);
    expect(actions.setFundReturnTo).not.toHaveBeenCalled();
    expect(actions.setShowFundPanel).not.toHaveBeenCalled();
    expect(SAVINGS_SHORTFALL_RETURN_TO).toBe('/wallet?action=savings');
  });
});
