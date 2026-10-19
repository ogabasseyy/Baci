import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { NativeCartMergeConflicts } from './NativeCartMergeConflicts';

const item = { productId: '11111111-1111-4111-8111-111111111111' };

describe('NativeCartMergeConflicts', () => {
  it('collapses sibling lanes that share one product identity into a single choice', () => {
    const onPick = jest.fn();
    const view = render(
      <NativeCartMergeConflicts
        colors={Colors.light}
        conflicts={[
          {
            item,
            existing: { quantity: 1 },
            incoming: {
              quantity: 1,
              voucherToken: 'tok-a',
              voucherAwardId: 'award-a',
            },
          },
          {
            item,
            existing: { quantity: 2, negotiatedUnitPriceMinor: 9000 },
            incoming: { quantity: 3, negotiatedUnitPriceMinor: 8000 },
          },
        ]}
        disabled={false}
        onPick={onPick}
      />
    );
    // The planner applies one resolution per base item, so the two
    // lanes render a single product-level choice instead of two
    // independently-looking picks that would overwrite each other.
    expect(view.getAllByText('Keep saved offer')).toHaveLength(1);
    expect(view.getAllByText('Keep this cart offer')).toHaveLength(1);
    fireEvent.press(view.getByText('Keep saved offer'));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith({ item, keep: 'incoming' });
  });
});
