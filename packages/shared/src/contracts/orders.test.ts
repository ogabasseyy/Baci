import { describe, expect, it } from 'vitest';
import {
  extractOrderDeliveryAddress,
  MOBILE_ADMIN_ORDER_COLUMNS,
  MOBILE_ADMIN_ORDER_ITEMS_COLUMNS,
  MOBILE_ADMIN_ORDER_WITH_ITEMS_QUERY,
  normalizeOrderEditChangeCategory,
  shouldNotifyCustomerForOrderEdit,
  WEB_ORDER_COLUMNS,
  WEB_ORDER_COLUMNS_PUBLIC,
  WEB_ORDER_ITEMS_COLUMNS,
  WEB_ORDER_WITH_ITEMS_QUERY,
} from './orders';

describe('order column constants', () => {
  const webColumns = WEB_ORDER_COLUMNS.split(',').map((column) =>
    column.trim()
  );
  const publicWebColumns = WEB_ORDER_COLUMNS_PUBLIC.split(',').map((column) =>
    column.trim()
  );
  const mobileAdminColumns = MOBILE_ADMIN_ORDER_COLUMNS.split(',').map(
    (column) => column.trim()
  );

  it('WEB_ORDER_COLUMNS is a non-empty string', () => {
    expect(typeof WEB_ORDER_COLUMNS).toBe('string');
    expect(WEB_ORDER_COLUMNS.length).toBeGreaterThan(0);
  });

  it('WEB_ORDER_ITEMS_COLUMNS is a non-empty string', () => {
    expect(typeof WEB_ORDER_ITEMS_COLUMNS).toBe('string');
    expect(WEB_ORDER_ITEMS_COLUMNS.length).toBeGreaterThan(0);
    expect(WEB_ORDER_ITEMS_COLUMNS).toContain('condition');
    expect(WEB_ORDER_ITEMS_COLUMNS).toContain('fulfillment_data');
    expect(WEB_ORDER_ITEMS_COLUMNS).toContain('image_url');
    expect(WEB_ORDER_ITEMS_COLUMNS).toContain('variant_name');
  });

  it('WEB_ORDER_WITH_ITEMS_QUERY composes order and item columns', () => {
    expect(WEB_ORDER_WITH_ITEMS_QUERY).toContain(WEB_ORDER_COLUMNS);
    expect(WEB_ORDER_WITH_ITEMS_QUERY).toContain('order_items(');
  });

  it('MOBILE_ADMIN_ORDER_COLUMNS is a non-empty string', () => {
    expect(typeof MOBILE_ADMIN_ORDER_COLUMNS).toBe('string');
    expect(MOBILE_ADMIN_ORDER_COLUMNS.length).toBeGreaterThan(0);
    expect(MOBILE_ADMIN_ORDER_COLUMNS).toContain('transaction_date');
    expect(MOBILE_ADMIN_ORDER_COLUMNS).toContain('invoice_issue_date');
  });

  it('column constants do not use select(*)', () => {
    expect(WEB_ORDER_COLUMNS).not.toContain('*');
    expect(WEB_ORDER_ITEMS_COLUMNS).not.toContain('*');
    expect(WEB_ORDER_WITH_ITEMS_QUERY).not.toContain('*');
    expect(MOBILE_ADMIN_ORDER_COLUMNS).not.toContain('*');
  });

  it('WEB_ORDER_COLUMNS does not include unsupported production columns', () => {
    expect(webColumns).not.toContain('payment_reference');
  });

  it('WEB_ORDER_COLUMNS includes amount_paid for payment tracking', () => {
    expect(webColumns).toContain('amount_paid');
  });

  it('WEB_ORDER_COLUMNS includes payment breakdown basis fields', () => {
    expect(webColumns).toEqual(
      expect.arrayContaining(['gift_wrapping_fee', 'tax_basis'])
    );
  });

  it('WEB_ORDER_COLUMNS_PUBLIC includes payment breakdown basis fields', () => {
    expect(publicWebColumns).toEqual(
      expect.arrayContaining(['gift_wrapping_fee', 'tax_basis'])
    );
  });

  it('includes branch_id in web and mobile admin order contracts', () => {
    expect(webColumns).toContain('branch_id');
    expect(mobileAdminColumns).toContain('branch_id');
  });

  it('includes delivery metadata in internal fulfillment projections', () => {
    expect(webColumns).toEqual(
      expect.arrayContaining(['delivery_method', 'airport_type'])
    );
    expect(mobileAdminColumns).toEqual(
      expect.arrayContaining(['delivery_method', 'airport_type'])
    );
  });

  it('includes mobile admin order detail fields required by the app', () => {
    expect(mobileAdminColumns).toContain('amount_paid');
    expect(mobileAdminColumns).toContain('fulfillment_type');
    expect(mobileAdminColumns).toContain('fulfillment_details');
    expect(mobileAdminColumns).toContain('self_fulfillment_data');
    expect(mobileAdminColumns).toContain('recorded_by_user_id');
    expect(mobileAdminColumns).toContain('gift_wrapping_fee');
    expect(mobileAdminColumns).toContain('tax_basis');
    expect(mobileAdminColumns).toContain('tax_exclusive_amount');
    expect(mobileAdminColumns).toContain('tax_inclusive_amount');
  });

  it('includes mobile admin order item snapshot fields required by edit mode', () => {
    const mobileItemColumns = MOBILE_ADMIN_ORDER_ITEMS_COLUMNS.split(',').map(
      (column) => column.trim()
    );

    expect(mobileItemColumns).toEqual(
      expect.arrayContaining([
        'condition',
        'details:item_description',
        'image_url',
        'item_description',
        'product_name:name',
        'product_match_status',
        'variant_id',
        'variant_attributes',
        'variant_name',
      ])
    );
    expect(MOBILE_ADMIN_ORDER_ITEMS_COLUMNS).not.toContain('*');
  });

  it('MOBILE_ADMIN_ORDER_WITH_ITEMS_QUERY composes order and item columns', () => {
    expect(MOBILE_ADMIN_ORDER_WITH_ITEMS_QUERY).toContain(
      MOBILE_ADMIN_ORDER_COLUMNS
    );
    expect(MOBILE_ADMIN_ORDER_WITH_ITEMS_QUERY).toContain('items:order_items(');
    expect(MOBILE_ADMIN_ORDER_WITH_ITEMS_QUERY).toContain(
      MOBILE_ADMIN_ORDER_ITEMS_COLUMNS
    );
  });
});

describe('normalizeOrderEditChangeCategory', () => {
  it('keeps supported categories and rejects unsupported RPC values', () => {
    expect(normalizeOrderEditChangeCategory('financial')).toBe('financial');
    expect(normalizeOrderEditChangeCategory('customer_visible')).toBe(
      'customer_visible'
    );
    expect(normalizeOrderEditChangeCategory('internal')).toBe('internal');
    expect(normalizeOrderEditChangeCategory('none')).toBeNull();
    expect(normalizeOrderEditChangeCategory(null)).toBeNull();
    expect(normalizeOrderEditChangeCategory(undefined)).toBeNull();
    expect(normalizeOrderEditChangeCategory(123)).toBeNull();
  });
});

describe('shouldNotifyCustomerForOrderEdit', () => {
  it('allows customer-visible and financial opt-in changes', () => {
    expect(
      shouldNotifyCustomerForOrderEdit({
        change_category: 'customer_visible',
        notify_customer: true,
      })
    ).toBe(true);
    expect(
      shouldNotifyCustomerForOrderEdit({
        change_category: 'financial',
        notify_customer: true,
      })
    ).toBe(true);
  });

  it('rejects internal or opt-out changes', () => {
    expect(
      shouldNotifyCustomerForOrderEdit({
        change_category: 'internal',
        notify_customer: true,
      })
    ).toBe(false);
    expect(
      shouldNotifyCustomerForOrderEdit({
        change_category: 'financial',
        notify_customer: false,
      })
    ).toBe(false);
    expect(shouldNotifyCustomerForOrderEdit({})).toBe(false);
    expect(
      shouldNotifyCustomerForOrderEdit({
        change_category: null,
        notify_customer: true,
      })
    ).toBe(false);
    expect(
      shouldNotifyCustomerForOrderEdit({
        change_category: 'financial',
      })
    ).toBe(false);
  });
});

describe('extractOrderDeliveryAddress', () => {
  it('returns a trimmed string when given a string input', () => {
    expect(extractOrderDeliveryAddress('  123 Main St  ')).toBe('123 Main St');
  });

  it('returns the string as-is when already trimmed', () => {
    expect(extractOrderDeliveryAddress('456 Oak Ave')).toBe('456 Oak Ave');
  });

  it('returns null for an empty string', () => {
    expect(extractOrderDeliveryAddress('')).toBeNull();
  });

  it('returns null for a whitespace-only string', () => {
    expect(extractOrderDeliveryAddress('   ')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(extractOrderDeliveryAddress(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(extractOrderDeliveryAddress(undefined)).toBeNull();
  });

  it('extracts address from object with address field', () => {
    expect(extractOrderDeliveryAddress({ address: '789 Pine Rd' })).toBe(
      '789 Pine Rd'
    );
  });

  it('extracts address_line1 when address is missing', () => {
    expect(extractOrderDeliveryAddress({ address_line1: '101 Elm Blvd' })).toBe(
      '101 Elm Blvd'
    );
  });

  it('prefers address over address_line1', () => {
    expect(
      extractOrderDeliveryAddress({
        address: 'Primary',
        address_line1: 'Fallback',
      })
    ).toBe('Primary');
  });

  it('returns null for object with empty address fields', () => {
    expect(
      extractOrderDeliveryAddress({ address: '', address_line1: '' })
    ).toBeNull();
  });

  it('returns null for object with whitespace-only address', () => {
    expect(extractOrderDeliveryAddress({ address: '  ' })).toBeNull();
  });

  it('returns null for object with no address fields', () => {
    expect(extractOrderDeliveryAddress({ foo: 'bar' })).toBeNull();
  });

  it('returns null for non-object, non-string types (number)', () => {
    expect(extractOrderDeliveryAddress(42)).toBeNull();
  });

  it('trims address from object', () => {
    expect(extractOrderDeliveryAddress({ address: '  Spaced Out  ' })).toBe(
      'Spaced Out'
    );
  });

  it('falls back to address_line1 when address is null', () => {
    expect(
      extractOrderDeliveryAddress({ address: null, address_line1: 'Fallback' })
    ).toBe('Fallback');
  });

  it('ignores non-string address fields inside shipping address objects', () => {
    expect(
      extractOrderDeliveryAddress({
        address: 42,
        address_line1: 'Object fallback',
      })
    ).toBe('Object fallback');
    expect(
      extractOrderDeliveryAddress({
        address: false,
        address_line1: ['bad'],
      })
    ).toBeNull();
  });
});
