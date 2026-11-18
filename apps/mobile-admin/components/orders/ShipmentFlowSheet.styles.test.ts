// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { styles } from './ShipmentFlowSheet.styles';

describe('ShipmentFlowSheet styles', () => {
  it('keeps the outside dismiss region covering the space above the sheet', () => {
    expect(styles.dismissRegion).toMatchObject({
      flex: 1,
      width: '100%',
    });
  });

  it('defines compact progress counter styles for long fulfillment flows', () => {
    expect(styles.stepCounter).toMatchObject({
      alignItems: 'center',
      flexDirection: 'row',
    });
    expect(styles.stepCounterCopy).toMatchObject({
      flex: 1,
    });
  });
});
