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

describe('bugfix: deposits showed the gross transfer, not what was credited', () => {
  it('shows the credited amount and names the fee so rows add up', () => {
    render(
      <PiggyvestActivityRow
        colors={Colors.light}
        item={activityItem({ amountKobo: 55000, feeKobo: 5000 })}
      />
    );

    expect(screen.getByText('+₦550')).toBeOnTheScreen();
    expect(screen.getByText(/₦50 fee deducted/)).toBeOnTheScreen();
  });

  it('adds no fee line when there was none', () => {
    render(
      <PiggyvestActivityRow colors={Colors.light} item={activityItem()} />
    );
    expect(screen.queryByText(/fee deducted/)).toBeNull();
  });
});

describe('bugfix: a four-digit amount touched the fee/date subtitle', () => {
  it('keeps the amount on its own width with a gap from the subtitle', () => {
    render(
      <PiggyvestActivityRow
        colors={Colors.light}
        item={activityItem({ amountKobo: 245000, feeKobo: 5000 })}
      />
    );
    const amount = screen.getByText('+₦2,450');
    const style = Object.assign(
      {},
      ...[amount.props.style].flat(Number.POSITIVE_INFINITY).filter(Boolean)
    );
    expect(style.flexShrink).toBe(0);
    expect(style.marginLeft).toBeGreaterThanOrEqual(12);
    expect(amount.props.numberOfLines).toBe(1);
  });
});
