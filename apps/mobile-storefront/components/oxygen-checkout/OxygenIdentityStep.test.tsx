import type { OxygenRuntimeSnapshot } from '@baci/shared/oxygen';
import { render, screen } from '@testing-library/react-native';
import { OxygenIdentityStep } from './OxygenIdentityStep';

const snapshot = {
  ninAttemptStatus: 'unavailable',
  state: { kyc: { bvn_status: 'DONE', nin_status: 'NOT_DONE' } },
  pending: null,
} as OxygenRuntimeSnapshot;
it('never claims validation is running while its admission status is unavailable', () => {
  render(
    <OxygenIdentityStep
      snapshot={snapshot}
      busy={false}
      onVerify={jest.fn()}
      onRefresh={jest.fn()}
    />
  );
  expect(screen.queryByText('Validating your NIN')).toBeNull();
  expect(
    screen.getByText('We couldn’t start your identity check')
  ).toBeTruthy();
  expect(
    screen.getAllByRole('button', { name: 'Check for an update' })
  ).toHaveLength(1);
});
it('shows validation progress only when Oxygen has marked it processing', () => {
  render(
    <OxygenIdentityStep
      snapshot={{
        ...snapshot,
        state: {
          ...snapshot.state,
          kyc: {
            bvn_status: 'DONE',
            nin_status: 'PROCESSING',
            phone_status: 'DONE',
            selfie_status: 'DONE',
            bank_status: 'NOT_DONE',
            address_status: 'NOT_DONE',
          },
        },
      }}
      busy={false}
      onVerify={jest.fn()}
      onRefresh={jest.fn()}
    />
  );
  expect(screen.getByText('Validating your NIN')).toBeTruthy();
});
