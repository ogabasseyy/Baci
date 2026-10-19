import { fireEvent, render, screen } from '@testing-library/react-native';
import { SavingsPlanFundingDetails } from './SavingsPlanFundingDetails';

describe('SavingsPlanFundingDetails', () => {
  it('rechecks a pending mapping without prompting the customer for BVN', () => {
    const onFetchExisting = jest.fn();
    const onFetchWithIdentity = jest.fn();

    render(
      <SavingsPlanFundingDetails
        amount={250000}
        copied={false}
        error={null}
        goalTitle="iPhone savings"
        isHostedStaging
        onCopy={async () => undefined}
        onFetchExisting={onFetchExisting}
        onFetchWithIdentity={onFetchWithIdentity}
        phase="pending"
        requiresIdentity={false}
      />
    );

    expect(
      screen.getByText(/dedicated account is being prepared/i)
    ).toBeOnTheScreen();
    expect(screen.queryByLabelText('BVN for plan account')).toBeNull();
    fireEvent.press(
      screen.getByRole('button', { name: 'Check account status' })
    );
    expect(onFetchExisting).toHaveBeenCalledTimes(1);
    expect(onFetchWithIdentity).not.toHaveBeenCalled();
  });

  it('only submits BVN after the mapping is unavailable and the customer chooses setup', () => {
    const onFetchWithIdentity = jest.fn();

    render(
      <SavingsPlanFundingDetails
        amount={250000}
        copied={false}
        error={null}
        goalTitle="iPhone savings"
        isHostedStaging={false}
        onCopy={async () => undefined}
        onFetchExisting={jest.fn()}
        onFetchWithIdentity={onFetchWithIdentity}
        phase="unavailable"
        requiresIdentity
      />
    );

    fireEvent.changeText(
      screen.getByLabelText('BVN for plan account'),
      '00000000000'
    );
    fireEvent.press(screen.getByRole('button', { name: 'Show plan account' }));
    expect(onFetchWithIdentity).toHaveBeenCalledWith('00000000000');
  });

  it('keeps retryable errors on account recheck without requesting BVN', () => {
    const onFetchExisting = jest.fn();

    render(
      <SavingsPlanFundingDetails
        amount={250000}
        copied={false}
        error="Unable to load the plan account."
        goalTitle="iPhone savings"
        isHostedStaging={false}
        onCopy={async () => undefined}
        onFetchExisting={onFetchExisting}
        onFetchWithIdentity={jest.fn()}
        phase="error"
        requiresIdentity={false}
      />
    );

    expect(screen.queryByLabelText('BVN for plan account')).toBeNull();
    fireEvent.press(
      screen.getByRole('button', { name: 'Check account status' })
    );
    expect(onFetchExisting).toHaveBeenCalledTimes(1);
  });

  it('never prompts for BVN in hosted staging', () => {
    render(
      <SavingsPlanFundingDetails
        amount={250000}
        copied={false}
        error={null}
        goalTitle="iPhone savings"
        isHostedStaging
        onCopy={async () => undefined}
        onFetchExisting={jest.fn()}
        onFetchWithIdentity={jest.fn()}
        phase="unavailable"
        requiresIdentity
      />
    );

    expect(screen.queryByLabelText('BVN for plan account')).toBeNull();
    expect(
      screen.getByText(/approved operators complete in the test environment/i)
    ).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Check account status' })
    ).toBeOnTheScreen();
  });

  it('withholds the account card when a ready account has an empty number', () => {
    render(
      <SavingsPlanFundingDetails
        account={{
          accountName: 'PiggyVest Savings',
          accountNumber: '',
          bankName: 'Test Bank',
        }}
        amount={250000}
        copied={false}
        error={null}
        goalTitle="iPhone savings"
        isHostedStaging
        onCopy={async () => undefined}
        onFetchExisting={jest.fn()}
        onFetchWithIdentity={jest.fn()}
        phase="ready"
        requiresIdentity={false}
      />
    );

    expect(
      screen.queryByRole('button', { name: 'Copy plan account number' })
    ).toBeNull();
    expect(
      screen.getByText(/looking for your existing dedicated account/i)
    ).toBeOnTheScreen();
  });

  it('copies a usable ready account number', () => {
    const onCopy = jest.fn(async () => undefined);
    render(
      <SavingsPlanFundingDetails
        account={{
          accountName: 'PiggyVest Savings',
          accountNumber: '0001234567',
          bankName: 'Test Bank',
        }}
        amount={250000}
        copied={false}
        error={null}
        goalTitle="iPhone savings"
        isHostedStaging
        onCopy={onCopy}
        onFetchExisting={jest.fn()}
        onFetchWithIdentity={jest.fn()}
        phase="ready"
        requiresIdentity={false}
      />
    );

    fireEvent.press(
      screen.getByRole('button', { name: 'Copy plan account number' })
    );
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows an error when copying the account number fails', () => {
    render(
      <SavingsPlanFundingDetails
        account={{
          accountName: 'PiggyVest Savings',
          accountNumber: '0001234567',
          bankName: 'Test Bank',
        }}
        amount={250000}
        copied={false}
        copyFailed
        error={null}
        goalTitle="iPhone savings"
        isHostedStaging
        onCopy={async () => undefined}
        onFetchExisting={jest.fn()}
        onFetchWithIdentity={jest.fn()}
        phase="ready"
        requiresIdentity={false}
      />
    );

    expect(
      screen.getByRole('alert', { name: /could not copy/i })
    ).toBeOnTheScreen();
  });
});
