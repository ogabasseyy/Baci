// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { identifierStyles } from './ShipmentFlowIdentifier.styles';

describe('ShipmentFlowIdentifier styles', () => {
  it('keeps identifier scan controls as square icon buttons', () => {
    expect(identifierStyles.scanButton).toMatchObject({
      height: 44,
      width: 44,
    });
  });

  it('keeps the scanner overlay above the shipment sheet content', () => {
    expect(identifierStyles.scannerOverlay).toMatchObject({
      zIndex: 30,
    });
  });
});
