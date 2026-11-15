import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import {
  PRIMARY_WALLET_REVIEW_COPY,
  PrimaryWalletSetupReview,
} from './PrimaryWalletSetupReview';

describe('PiggyVest setup review with the server keeping PiggyVest off', () => {
  // Only the PiggyVest setup panel draws this; with PiggyVest off the panel
  // never mounts. Rendered alone it is a calm stop with no retry button.
  it('explains the review calmly and offers nothing to retry', () => {
    render(<PrimaryWalletSetupReview colors={Colors.light} />);

    expect(
      screen.getByText('We need to check a few details')
    ).toBeOnTheScreen();
    expect(screen.getByText(PRIMARY_WALLET_REVIEW_COPY)).toBeOnTheScreen();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
