import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { activityItem } from './activity-test-harness.test-support';
import { PiggyvestActivityRow } from './PiggyvestActivityRow';

describe('PiggyVest activity row with the server keeping PiggyVest off', () => {
  // Only the PiggyVest list draws rows; rendered alone it formats safely.
  it('shows money in as +₦ and money out as −₦ with kobo kept', () => {
    render(
      <>
        <PiggyvestActivityRow colors={Colors.light} item={activityItem()} />
        <PiggyvestActivityRow
          colors={Colors.light}
          item={activityItem({
            id: '00000000-0000-4000-8000-000000000002',
            direction: 'out',
            amountKobo: 12345,
            label: 'Saved to iPhone fund',
          })}
        />
      </>
    );

    expect(screen.getByText('+₦50,000')).toBeOnTheScreen();
    expect(screen.getByText('−₦123.45')).toBeOnTheScreen();
  });
});
