import { fireEvent, render, screen } from '@testing-library/react-native';
import AppKeyboardAwareScrollView from '@/components/ui/AppKeyboardAwareScrollView';
import { OxygenApplicationSteps } from './OxygenApplicationSteps';

jest.mock('@/components/ui/AppKeyboardAwareScrollView', () => ({
  __esModule: true,
  default: ({ children, ...props }: { children: React.ReactNode }) => {
    const { ScrollView } = require('react-native');
    return <ScrollView {...props}>{children}</ScrollView>;
  },
}));
jest.mock('./OxygenIdentityFields', () => ({
  OxygenIdentityFields: () => null,
}));
jest.mock('./OxygenBankStep', () => ({ OxygenBankStep: () => null }));
jest.mock('./OxygenIncomeStep', () => ({ OxygenIncomeStep: () => null }));
jest.mock('./OxygenVerificationTrust', () => ({
  OxygenVerificationTrust: () => null,
}));

it('allows local step navigation while an encrypted draft save is pending', () => {
  const next = jest.fn();
  render(
    <OxygenApplicationSteps
      step={0}
      fields={{}}
      banks={[]}
      onChange={jest.fn()}
      onResolveAccount={jest.fn()}
      active
      consent={false}
      onConsent={jest.fn()}
      proof={null}
      onPickProof={jest.fn()}
      onStepChange={next}
      onSubmit={jest.fn()}
      saving
    />
  );
  fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  expect(next).toHaveBeenCalledWith(1);
});

it('uses compact spacing on identity while keeping the form scrollable', () => {
  render(
    <OxygenApplicationSteps
      step={0}
      fields={{}}
      banks={[]}
      onChange={jest.fn()}
      onResolveAccount={jest.fn()}
      active
      consent={false}
      onConsent={jest.fn()}
      proof={null}
      onPickProof={jest.fn()}
      onStepChange={jest.fn()}
      onSubmit={jest.fn()}
    />
  );
  const scroll = screen.UNSAFE_getByType(AppKeyboardAwareScrollView);
  expect(scroll.props.contentContainerStyle.gap).toBe(12);
  expect(scroll.props.contentContainerStyle.paddingBottom).toBeGreaterThan(0);
});

it('allows the payday dropdown to consume nested scrolling within the form', () => {
  render(
    <OxygenApplicationSteps
      step={2}
      fields={{}}
      banks={[]}
      onChange={jest.fn()}
      onResolveAccount={jest.fn()}
      active
      consent={false}
      onConsent={jest.fn()}
      proof={null}
      onPickProof={jest.fn()}
      onStepChange={jest.fn()}
      onSubmit={jest.fn()}
    />
  );
  expect(
    screen.UNSAFE_getByType(AppKeyboardAwareScrollView).props
      .nestedScrollEnabled
  ).toBe(true);
  const buttons = screen.getAllByRole('button');
  expect(
    buttons.indexOf(
      screen.getByRole('button', { name: 'Continue verification' })
    )
  ).toBeLessThan(buttons.indexOf(screen.getByRole('button', { name: 'Back' })));
});

it.each([
  1, 2,
] as const)('offers bank catalog recovery on form step %s', (step) => {
  const retry = jest.fn();
  render(
    <OxygenApplicationSteps
      step={step}
      fields={{}}
      banks={[]}
      bankError="Could not load banks"
      onRetryBanks={retry}
      onChange={jest.fn()}
      onResolveAccount={jest.fn()}
      active
      consent={false}
      onConsent={jest.fn()}
      proof={null}
      onPickProof={jest.fn()}
      onStepChange={jest.fn()}
      onSubmit={jest.fn()}
    />
  );
  expect(screen.getByText('Could not load banks')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Retry loading banks' }));
  expect(retry).toHaveBeenCalledTimes(1);
});
