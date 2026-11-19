import { describe, expect, it } from 'vitest';
import {
  ExpectedBrandAuthorityInventoryRejectionError,
  isExpectedBrandAuthorityInventoryRejection,
} from './brand-authority-inventory-rejection';

describe('ExpectedBrandAuthorityInventoryRejectionError', () => {
  it('instantiates an error with the expected properties', () => {
    const error = new ExpectedBrandAuthorityInventoryRejectionError(
      'Brand category unavailable'
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ExpectedBrandAuthorityInventoryRejectionError);
    expect(error.name).toBe('ExpectedBrandAuthorityInventoryRejectionError');
    expect(error.message).toBe('Brand category unavailable');
    expect(error.isExpectedRejection).toBe(true);
  });
});

describe('isExpectedBrandAuthorityInventoryRejection', () => {
  it('returns true for ExpectedBrandAuthorityInventoryRejectionError instances', () => {
    const error = new ExpectedBrandAuthorityInventoryRejectionError(
      'Category missing'
    );
    expect(isExpectedBrandAuthorityInventoryRejection(error)).toBe(true);
  });

  it('returns true for error duck-typed objects with isExpectedRejection: true', () => {
    const duckTyped = {
      name: 'CustomError',
      message: 'Rejected',
      isExpectedRejection: true,
    };
    expect(isExpectedBrandAuthorityInventoryRejection(duckTyped)).toBe(true);
  });

  it('returns false for standard errors or non-matching error objects', () => {
    expect(
      isExpectedBrandAuthorityInventoryRejection(new Error('Network error'))
    ).toBe(false);
    expect(
      isExpectedBrandAuthorityInventoryRejection({ isExpectedRejection: false })
    ).toBe(false);
    expect(
      isExpectedBrandAuthorityInventoryRejection({
        isExpectedRejection: 'true',
      })
    ).toBe(false);
    expect(isExpectedBrandAuthorityInventoryRejection({})).toBe(false);
  });

  it('returns false for non-object or nullish values', () => {
    expect(isExpectedBrandAuthorityInventoryRejection(null)).toBe(false);
    expect(isExpectedBrandAuthorityInventoryRejection(undefined)).toBe(false);
    expect(isExpectedBrandAuthorityInventoryRejection('error message')).toBe(
      false
    );
    expect(isExpectedBrandAuthorityInventoryRejection(404)).toBe(false);
    expect(isExpectedBrandAuthorityInventoryRejection(false)).toBe(false);
    expect(isExpectedBrandAuthorityInventoryRejection(Symbol('err'))).toBe(
      false
    );
  });
});
