// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { customerCreateStyles } from './NewOrderCustomerCreateView.styles';

describe('NewOrderCustomerCreateView styles', () => {
  it('keeps the customer form grouped and finger-friendly', () => {
    expect(customerCreateStyles.content).toMatchObject({
      gap: 20,
      padding: 16,
      paddingBottom: 28,
    });
    expect(customerCreateStyles.field).toMatchObject({
      alignItems: 'center',
      borderRadius: 14,
      borderWidth: 1,
      flexDirection: 'row',
      minHeight: 56,
    });
  });

  it('keeps the compact country picker bounded inside the form', () => {
    expect(customerCreateStyles.countryDropdown).toMatchObject({
      borderRadius: 16,
      borderWidth: 1,
      gap: 10,
      padding: 10,
    });
    expect(customerCreateStyles.countryList).toMatchObject({ maxHeight: 220 });
  });
});
