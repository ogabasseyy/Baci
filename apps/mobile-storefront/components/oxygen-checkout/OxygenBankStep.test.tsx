import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { OxygenBankStep } from './OxygenBankStep';

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
describe('workflow-owned bank lookup', () => {
  it('looks up only complete numbers and suppresses stale responses', async () => {
    let first: (value: string) => void = () => {};
    let second: (value: string) => void = () => {};
    const resolve = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<string>((done) => {
            first = done;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<string>((done) => {
            second = done;
          })
      );
    const props = {
      fields: { bank_code: '001', account_number: '012345678' },
      banks: [],
      onChange: jest.fn(),
      onResolveAccount: resolve,
      onAccountName: jest.fn(),
      active: true,
    };
    const view = render(<OxygenBankStep {...props} />);
    expect(resolve).not.toHaveBeenCalled();
    view.rerender(
      <OxygenBankStep
        {...props}
        fields={{ ...props.fields, account_number: '0123456789' }}
      />
    );
    view.rerender(
      <OxygenBankStep
        {...props}
        fields={{ ...props.fields, account_number: '9876543210' }}
      />
    );
    await act(async () => second('Current name'));
    await act(async () => first('Old name'));
    expect(screen.getByText('Current name')).toBeTruthy();
    expect(screen.queryByText('Old name')).toBeNull();
  });
  it('does not resolve beyond application_required', () => {
    const resolve = jest.fn();
    render(
      <OxygenBankStep
        fields={{ bank_code: '001', account_number: '0123456789' }}
        banks={[]}
        onChange={jest.fn()}
        onResolveAccount={resolve}
        active={false}
      />
    );
    expect(resolve).not.toHaveBeenCalled();
  });
});

it('hides the empty account name card, then shows lookup and confirmed status', async () => {
  const resolve = jest.fn().mockResolvedValue('TEST CUSTOMER');
  const props = {
    fields: {},
    banks: [],
    onChange: jest.fn(),
    onResolveAccount: resolve,
    active: true,
  };
  const view = render(<OxygenBankStep {...props} />);
  expect(screen.queryByText('Account name')).toBeNull();
  expect(screen.queryByText('Waiting for your account details')).toBeNull();
  view.rerender(
    <OxygenBankStep
      {...props}
      fields={{ bank_code: '058', account_number: '0123456789' }}
    />
  );
  expect(screen.getByText('Verifying account…')).toBeTruthy();
  await act(async () => {});
  expect(screen.getByText('TEST CUSTOMER')).toBeTruthy();
  expect(screen.getByText('Account verified')).toBeTruthy();
  view.rerender(<OxygenBankStep {...props} />);
  expect(screen.queryByText('Account name')).toBeNull();
  expect(screen.queryByText('TEST CUSTOMER')).toBeNull();
});

it('shows a readable error and retries account lookup without submitting the application', async () => {
  const resolve = jest
    .fn()
    .mockRejectedValueOnce(new Error('Unavailable'))
    .mockResolvedValueOnce('TEST CUSTOMER');
  render(
    <OxygenBankStep
      fields={{ bank_code: '058', account_number: '0123456789' }}
      banks={[]}
      onChange={jest.fn()}
      onResolveAccount={resolve}
      active
    />
  );
  await act(async () => {});
  expect(screen.getByRole('alert')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  await act(async () => {});
  expect(resolve).toHaveBeenCalledTimes(2);
  expect(screen.getByText('Account verified')).toBeTruthy();
});
