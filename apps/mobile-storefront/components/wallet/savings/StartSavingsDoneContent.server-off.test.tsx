import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { StartSavingsDoneContent } from './StartSavingsDoneContent';
import {
  createPrimaryStartSavingsController,
  createStartSavingsController,
} from './start-savings-controller.test-support';

describe('StartSavingsDoneContent with PiggyVest off', () => {
  describe('bugfix: “off to a great start” was shown at ₦0', () => {
    it('says honestly that nothing has been taken yet', () => {
      render(
        <StartSavingsDoneContent
          colors={Colors.light}
          controller={createStartSavingsController()}
        />
      );
      expect(screen.getByText('Your plan is set')).toBeOnTheScreen();
      expect(
        screen.getByText(
          /^Nothing has been taken yet\. Save ₦2,000 a day from /
        )
      ).toBeOnTheScreen();
      expect(screen.queryByText(/great start/)).toBeNull();
    });
  });

  it('mentions a real head start and goes to the wallet', () => {
    const controller = createStartSavingsController({
      effectiveInitialContribution: 5000,
    });
    render(
      <StartSavingsDoneContent colors={Colors.light} controller={controller} />
    );
    expect(screen.getByText(/Your ₦5,000 head start is in/)).toBeOnTheScreen();
    expect(screen.queryByText(/getting it ready/)).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Go to wallet' }));
    expect(controller.goToWallet).toHaveBeenCalled();
  });
});

describe('StartSavingsDoneContent for a PiggyVest wallet', () => {
  it('says the plan is getting ready in the wallet', () => {
    render(
      <StartSavingsDoneContent
        colors={Colors.light}
        controller={createPrimaryStartSavingsController()}
      />
    );
    expect(
      screen.getByText(/getting it ready in your wallet/)
    ).toBeOnTheScreen();
  });
});

describe('bugfix: auto-debit plans were told to save from the wallet', () => {
  it('says the saved card is charged on saving days', () => {
    render(
      <StartSavingsDoneContent
        colors={Colors.light}
        controller={createStartSavingsController({ sourceMode: 'auto_debit' })}
      />
    );
    expect(
      screen.getByText(/We’ll charge your saved card ₦2,000 a day from /)
    ).toBeOnTheScreen();
    expect(screen.queryByText(/from your wallet/)).toBeNull();
  });
});

describe('bugfix: a full head start was asked for another payment', () => {
  it('says the plan is complete when the head start covers the phone', () => {
    render(
      <StartSavingsDoneContent
        colors={Colors.light}
        controller={createStartSavingsController({
          effectiveInitialContribution: 250000,
        })}
      />
    );
    expect(
      screen.getByText(/head start covers the whole phone/)
    ).toBeOnTheScreen();
    expect(screen.queryByText(/Next, save/)).toBeNull();
  });
});
