import { getSavingsCardContributionOptions } from '@/lib/savings-card-contributions';
import { refreshSavedCardMethods } from './refresh-saved-card-methods';

jest.mock('@/lib/savings-card-contributions', () => ({
  getSavingsCardContributionOptions: jest.fn(),
}));

const method = { id: 'method-1', brand: 'Visa', last4: '4242' };
const setters = () => ({
  setCapabilityLoaded: jest.fn(),
  setEnabled: jest.fn(),
  setMaximumAmountKobo: jest.fn(),
  setMethods: jest.fn(),
});

it('refreshes saved methods after first-card completion', async () => {
  jest.mocked(getSavingsCardContributionOptions).mockResolvedValue({
    goalId: 'goal-1',
    enabled: true,
    newCardEnabled: false,
    currency: 'NGN',
    maximumAmountKobo: 500000,
    savedMethods: [method],
  });
  const state = setters();
  await refreshSavedCardMethods({
    goalId: 'goal-1',
    isCurrent: () => true,
    onUnavailable: jest.fn(),
    ...state,
  });
  expect(state.setMethods).toHaveBeenCalledWith([method]);
  expect(state.setEnabled).toHaveBeenCalledWith(true);
  expect(state.setCapabilityLoaded).toHaveBeenCalledWith(true);
});

it('ignores results after the saved-card scope changes', async () => {
  jest.mocked(getSavingsCardContributionOptions).mockResolvedValue({
    goalId: 'goal-1',
    enabled: true,
    newCardEnabled: false,
    currency: 'NGN',
    maximumAmountKobo: 500000,
    savedMethods: [method],
  });
  const state = setters();
  await refreshSavedCardMethods({
    goalId: 'goal-1',
    isCurrent: () => false,
    onUnavailable: jest.fn(),
    ...state,
  });
  expect(state.setMethods).not.toHaveBeenCalled();
});
