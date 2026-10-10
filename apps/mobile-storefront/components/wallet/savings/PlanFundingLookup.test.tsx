import { fireEvent, render, screen } from '@testing-library/react-native';
import { PlanFundingLookup } from './PlanFundingLookup';

const colors = {
  background: '#000',
  border: '#333',
  card: '#111',
  error: '#f00',
  placeholder: '#888',
  primary: '#ff0',
  text: '#fff',
  textSecondary: '#aaa',
};

it.each([
  false,
  true,
])('requires BVN only for legacy setup: %s', (requiresBvn) => {
  const onFetch = jest.fn();
  render(
    <PlanFundingLookup
      colors={colors}
      controller={{
        planFundingRequiresBvn: requiresBvn,
        planFundingPhase: 'idle',
        planFundingError: null,
        isSubmitting: false,
      }}
      bvn=""
      earnInterest={false}
      onBvnChange={jest.fn()}
      onEarnInterestChange={jest.fn()}
      onFetch={onFetch}
    />
  );
  expect(Boolean(screen.queryByLabelText('BVN for plan account'))).toBe(
    requiresBvn
  );
  expect(
    screen.getByRole('checkbox', { name: 'Earn interest on this plan' })
  ).toBeOnTheScreen();
  fireEvent.press(screen.getByRole('button', { name: 'Show plan account' }));
  expect(onFetch).toHaveBeenCalledTimes(1);
});

it('uses status-only legacy hosted staging without collecting BVN or requesting provisioning', () => {
  const onFetch = jest.fn();
  const onCheckStatus = jest.fn();
  render(
    <PlanFundingLookup
      colors={colors}
      controller={{
        planFundingRequiresBvn: true,
        planFundingPhase: 'idle',
        planFundingError: null,
        isSubmitting: false,
      }}
      bvn=""
      earnInterest={false}
      isHostedStaging
      onBvnChange={jest.fn()}
      onEarnInterestChange={jest.fn()}
      onFetch={onFetch}
      onCheckStatus={onCheckStatus}
    />
  );
  expect(screen.queryByLabelText('BVN for plan account')).toBeNull();
  expect(
    screen.queryByRole('checkbox', { name: 'Earn interest on this plan' })
  ).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Check account status' }));
  expect(onCheckStatus).toHaveBeenCalledTimes(1);
  expect(onFetch).not.toHaveBeenCalled();
});

it('keeps primary verified provisioning available even in a hosted staging runtime', () => {
  const onFetch = jest.fn();
  const onCheckStatus = jest.fn();
  render(
    <PlanFundingLookup
      colors={colors}
      controller={{
        planFundingRequiresBvn: false,
        planFundingPhase: 'idle',
        planFundingError: null,
        isSubmitting: false,
      }}
      bvn=""
      earnInterest={false}
      isHostedStaging
      onBvnChange={jest.fn()}
      onEarnInterestChange={jest.fn()}
      onFetch={onFetch}
      onCheckStatus={onCheckStatus}
    />
  );
  expect(screen.queryByLabelText('BVN for plan account')).toBeNull();
  expect(
    screen.getByRole('checkbox', { name: 'Earn interest on this plan' })
  ).toBeOnTheScreen();
  fireEvent.press(screen.getByRole('button', { name: 'Show plan account' }));
  expect(onFetch).toHaveBeenCalledTimes(1);
  expect(onCheckStatus).not.toHaveBeenCalled();
});
