import { describe, expect, it } from 'vitest';
import {
  createJumiaProductExportSelectionSchema,
  jumiaProductExportEligibleQuerySchema,
  jumiaProductExportSelectionRpcRowSchema,
} from './product-export-selection';

describe('Jumia product export selection schemas', () => {
  it('accepts only a canonical source category UUID for snapshot creation', () => {
    expect(
      createJumiaProductExportSelectionSchema.safeParse({
        sourceCategoryId: '00000000-0000-4000-8000-000000000001',
        merchantId: '00000000-0000-4000-8000-000000000002',
      }).success
    ).toBe(true);
    expect(
      createJumiaProductExportSelectionSchema.safeParse({
        sourceCategoryId: 'Gaming',
      }).success
    ).toBe(false);
    expect(
      createJumiaProductExportSelectionSchema.safeParse({
        sourceCategoryId: '00000000-0000-4000-8000-000000000001',
      }).success
    ).toBe(false);
    expect(
      createJumiaProductExportSelectionSchema.safeParse({
        sourceCategoryId: '00000000-0000-4000-8000-000000000001',
        merchantId: 'not-a-uuid',
      }).success
    ).toBe(false);
  });

  it('coerces bounded eligible snapshot pagination from query parameters', () => {
    expect(
      jumiaProductExportEligibleQuerySchema.safeParse({
        selectionId: '00000000-0000-4000-8000-000000000001',
        merchantId: '00000000-0000-4000-8000-000000000002',
        page: '2',
        limit: '50',
      })
    ).toMatchObject({
      success: true,
      data: {
        selectionId: '00000000-0000-4000-8000-000000000001',
        merchantId: '00000000-0000-4000-8000-000000000002',
        page: 2,
        limit: 50,
      },
    });
    expect(
      jumiaProductExportEligibleQuerySchema.safeParse({
        selectionId: '00000000-0000-4000-8000-000000000001',
        merchantId: '00000000-0000-4000-8000-000000000002',
        page: '0',
      }).success
    ).toBe(false);
    expect(
      jumiaProductExportEligibleQuerySchema.safeParse({
        selectionId: '00000000-0000-4000-8000-000000000001',
        merchantId: 'not-a-uuid',
      }).success
    ).toBe(false);
    expect(
      jumiaProductExportEligibleQuerySchema.safeParse({
        selectionId: '00000000-0000-4000-8000-000000000001',
        merchantId: '00000000-0000-4000-8000-000000000002',
        limit: '501',
      }).success
    ).toBe(false);
    expect(
      jumiaProductExportEligibleQuerySchema.safeParse({
        selectionId: '00000000-0000-4000-8000-000000000001',
      }).success
    ).toBe(false);
  });

  it('narrows the snapshot RPC row before returning a success response', () => {
    expect(
      jumiaProductExportSelectionRpcRowSchema.safeParse({
        selection_id: '00000000-0000-4000-8000-000000000001',
        total: 0,
        captured_at: '2026-10-23T00:00:00Z',
        expires_at: '2026-10-24T00:00:00Z',
      }).success
    ).toBe(true);
    expect(
      jumiaProductExportSelectionRpcRowSchema.safeParse({
        selection_id: 'not-a-uuid',
        total: '1',
      }).success
    ).toBe(false);
  });
});
