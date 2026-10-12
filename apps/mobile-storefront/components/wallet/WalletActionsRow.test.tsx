import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import Colors from '@/constants/Colors';
import { WalletActionsRow } from './WalletActionsRow';

describe('WalletActionsRow', () => {
  it('keeps card management without duplicating the active plan action', () => {
    render(
      <WalletActionsRow
        hasSavedCards
        colors={Colors.dark}
        hasActiveSavingsGoal
        onManageCards={jest.fn()}
        onQuickSave={jest.fn()}
        onStartSavings={jest.fn()}
        showPrimaryAction={false}
        showQuickSave={false}
      />
    );

    expect(
      screen.getByRole('button', { name: 'Manage Cards' })
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Add to Savings' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Quick Save' })).toBeNull();
  });
  it('wires primary wallet actions', () => {
    const onManageCards = jest.fn();
    const onQuickSave = jest.fn();
    const onStartSavings = jest.fn();

    render(
      <WalletActionsRow
        hasSavedCards
        colors={Colors.light}
        hasActiveSavingsGoal={false}
        onManageCards={onManageCards}
        onQuickSave={onQuickSave}
        onStartSavings={onStartSavings}
        showQuickSave
      />
    );

    fireEvent.press(screen.getByRole('button', { name: 'Start Savings' }));
    fireEvent.press(screen.getByRole('button', { name: 'Manage Cards' }));
    fireEvent.press(screen.getByRole('button', { name: 'Quick Save' }));

    expect(onStartSavings).toHaveBeenCalledTimes(1);
    expect(onManageCards).toHaveBeenCalledTimes(1);
    expect(onQuickSave).toHaveBeenCalledTimes(1);
  });

  it('hides quick save when no savings context is active', () => {
    const noop = jest.fn();

    render(
      <WalletActionsRow
        hasSavedCards
        colors={Colors.light}
        hasActiveSavingsGoal={false}
        onManageCards={noop}
        onQuickSave={noop}
        onStartSavings={noop}
        showQuickSave={false}
      />
    );

    expect(screen.queryByRole('button', { name: 'Quick Save' })).toBeNull();
  });

  it.each([
    'light',
    'dark',
  ] as const)('keeps manage cards readable in %s mode', (theme) => {
    const noop = jest.fn();

    render(
      <WalletActionsRow
        hasSavedCards
        colors={Colors[theme]}
        hasActiveSavingsGoal={false}
        onManageCards={noop}
        onQuickSave={noop}
        onStartSavings={noop}
        showQuickSave={false}
      />
    );

    expect(
      StyleSheet.flatten(screen.getByText('Manage Cards').props.style)
    ).toEqual(expect.objectContaining({ color: Colors[theme].text }));
    expect(
      StyleSheet.flatten(
        screen.getByRole('button', { name: 'Manage Cards' }).props.style
      )
    ).toEqual(expect.objectContaining({ backgroundColor: Colors[theme].card }));
  });

  it('uses the savings top-up label when a savings goal is active', () => {
    const onStartSavings = jest.fn();

    render(
      <WalletActionsRow
        hasSavedCards
        colors={Colors.light}
        hasActiveSavingsGoal
        onManageCards={jest.fn()}
        onQuickSave={jest.fn()}
        onStartSavings={onStartSavings}
        showQuickSave
      />
    );

    fireEvent.press(screen.getByRole('button', { name: 'Add to Savings' }));

    expect(screen.queryByText('Start Savings')).toBeNull();
    expect(screen.getByText('Add to Savings')).toBeOnTheScreen();
    expect(onStartSavings).toHaveBeenCalledTimes(1);
  });
});

it('hides card management when the customer has no saved cards', () => {
  render(
    <WalletActionsRow
      colors={Colors.light}
      hasSavedCards={false}
      hasActiveSavingsGoal={false}
      onManageCards={jest.fn()}
      onQuickSave={jest.fn()}
      onStartSavings={jest.fn()}
      showQuickSave={false}
    />
  );
  expect(screen.queryByRole('button', { name: 'Manage Cards' })).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Start Savings' })
  ).toBeOnTheScreen();
});
