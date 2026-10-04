import { describe, expect, it } from '@jest/globals';
import {
  getActiveSavingsGoal,
  type SavingsGoalData,
  toActiveSavingsGoal,
} from './wallet-savings-data';

const activeGoal = {
  contribution_amount: '10000',
  contribution_frequency: 'weekly',
  current_amount: '20000',
  id: 'goal-1',
  maturity_date: '2026-09-30',
  product_id: 'product-1',
  product_snapshot: {},
  source_mode: 'manual',
  status: 'active',
  target_amount: '120000',
  title: 'iPhone 15 Pro',
  variant_id: 'variant-1',
} satisfies SavingsGoalData;

describe('wallet savings data helpers', () => {
  it('prefers active goals over paused or completed goals', () => {
    expect(
      getActiveSavingsGoal([
        { ...activeGoal, id: 'goal-paused', status: 'paused' },
        activeGoal,
      ])
    ).toEqual(activeGoal);
  });

  it('falls back to completed goals for completed-state display', () => {
    const completedGoal = {
      ...activeGoal,
      status: 'completed',
    } satisfies SavingsGoalData;

    expect(getActiveSavingsGoal([completedGoal])).toEqual(completedGoal);
  });

  it('prefers paused goals over completed goals', () => {
    expect(
      getActiveSavingsGoal([
        { ...activeGoal, id: 'goal-completed', status: 'completed' },
        { ...activeGoal, id: 'goal-paused', status: 'paused' },
      ])
    ).toEqual({ ...activeGoal, id: 'goal-paused', status: 'paused' });
  });

  it('hydrates active savings goal display metadata from product data', () => {
    expect(
      toActiveSavingsGoal({
        goal: activeGoal,
        product: {
          condition: 'uk_used',
          id: 'product-1',
          images: ['https://cdn.example.com/product.jpg'],
          name: 'iPhone 15 Pro',
          variants: [
            {
              attributes: { color: 'Black', storage: '256GB' },
              condition: 'new',
              id: 'variant-1',
              images: ['https://cdn.example.com/variant.jpg'],
              price: '120000',
            },
          ],
        },
      })
    ).toEqual({
      contribution_amount: 10000,
      contribution_frequency: 'weekly',
      current_amount: 20000,
      id: 'goal-1',
      maturity_date: '2026-09-30',
      product_condition: 'New',
      product_image: 'https://cdn.example.com/variant.jpg',
      product_variant_label: 'Color: Black · Storage: 256GB',
      selection_unresolved: false,
      source_mode: 'manual',
      status: 'active',
      target_amount: 120000,
      title: 'iPhone 15 Pro',
    });
  });

  it('returns null when database amounts cannot be coerced', () => {
    expect(
      toActiveSavingsGoal({
        goal: {
          ...activeGoal,
          contribution_amount: 'invalid',
        },
      })
    ).toBeNull();
    expect(
      toActiveSavingsGoal({
        goal: {
          ...activeGoal,
          target_amount: 'NaN',
        },
      })
    ).toBeNull();
  });

  it('falls back to product-level image when the selected variant is missing', () => {
    expect(
      toActiveSavingsGoal({
        goal: { ...activeGoal, variant_id: 'missing-variant' },
        product: {
          condition: 'uk_used',
          id: 'product-1',
          images: ['https://cdn.example.com/product.jpg'],
          name: 'iPhone 15 Pro',
          variants: [
            {
              attributes: { storage: '128GB' },
              id: 'variant-1',
              images: ['https://cdn.example.com/variant.jpg'],
            },
          ],
        },
      })
    ).toEqual(
      expect.objectContaining({
        product_condition: 'Used',
        product_image: 'https://cdn.example.com/product.jpg',
        product_variant_label: 'Exact variant unavailable',
        selection_unresolved: true,
      })
    );
  });

  it('offers priced variants for re-selection when the selection is unresolved', () => {
    expect(
      toActiveSavingsGoal({
        goal: { ...activeGoal, status: 'completed', variant_id: null },
        product: {
          id: 'product-1',
          images: ['https://cdn.example.com/product.jpg'],
          name: 'iPhone 15 Pro',
          price: '700000',
          variants: [
            {
              attributes: { storage: '128GB' },
              condition: 'new',
              id: 'variant-128',
              price_override: '15000',
            },
            {
              attributes: { storage: '256GB' },
              condition: 'new',
              id: 'variant-256',
              price_override: '18000',
            },
          ],
        },
      })
    ).toEqual(
      expect.objectContaining({
        selection_unresolved: true,
        variant_resolution_options: [
          { id: 'variant-128', label: 'New · Storage: 128GB' },
          { id: 'variant-256', label: 'New · Storage: 256GB' },
        ],
      })
    );
  });

  it('does not mark a product with only an inventory anchor unresolved', () => {
    expect(
      toActiveSavingsGoal({
        goal: { ...activeGoal, variant_id: null },
        product: {
          id: 'product-1',
          images: ['https://cdn.example.com/product.jpg'],
          name: 'iPhone 15 Pro',
          variants: [
            {
              id: 'inventory-anchor',
              is_inventory_anchor: true,
            },
          ],
        },
      })
    ).toEqual(
      expect.objectContaining({
        selection_unresolved: false,
      })
    );
  });

  it('prefers a selected variant single image when hydrating goal metadata', () => {
    expect(
      toActiveSavingsGoal({
        goal: activeGoal,
        product: {
          condition: 'uk_used',
          id: 'product-1',
          images: ['https://cdn.example.com/product.jpg'],
          name: 'iPhone 15 Pro',
          variants: [
            {
              attributes: { storage: '256GB' },
              id: 'variant-1',
              image: 'https://cdn.example.com/variant-single.jpg',
            },
          ],
        },
      })
    ).toEqual(
      expect.objectContaining({
        product_image: 'https://cdn.example.com/variant-single.jpg',
      })
    );
  });

  it('prefers a selected variant primary image from product embeds', () => {
    expect(
      toActiveSavingsGoal({
        goal: activeGoal,
        product: {
          condition: 'uk_used',
          id: 'product-1',
          images: ['https://cdn.example.com/product.jpg'],
          name: 'iPhone 15 Pro',
          variants: [
            {
              attributes: { storage: '256GB' },
              id: 'variant-1',
              primary_image: 'https://cdn.example.com/variant-primary.jpg',
            },
          ],
        },
      })
    ).toEqual(
      expect.objectContaining({
        product_image: 'https://cdn.example.com/variant-primary.jpg',
      })
    );
  });

  it('falls back to selected variant image when primary_image is empty', () => {
    expect(
      toActiveSavingsGoal({
        goal: activeGoal,
        product: {
          condition: 'uk_used',
          id: 'product-1',
          images: ['https://cdn.example.com/product.jpg'],
          name: 'iPhone 15 Pro',
          variants: [
            {
              attributes: { storage: '256GB' },
              id: 'variant-1',
              image: 'https://cdn.example.com/variant-fallback.jpg',
              primary_image: '',
            },
          ],
        },
      })
    ).toEqual(
      expect.objectContaining({
        product_image: 'https://cdn.example.com/variant-fallback.jpg',
      })
    );
  });

  it('hydrates general savings goals without a linked product id', () => {
    expect(
      getActiveSavingsGoal([
        {
          ...activeGoal,
          product_id: null,
          product_snapshot: {
            image: 'https://cdn.example.com/general.jpg',
            variantLabel: 'Emergency fund',
          },
          title: 'General savings',
          variant_id: null,
        },
      ])
    ).toEqual(
      expect.objectContaining({
        product_id: null,
        title: 'General savings',
      })
    );
    expect(
      toActiveSavingsGoal({
        goal: {
          ...activeGoal,
          product_id: null,
          product_snapshot: {
            image: 'https://cdn.example.com/general.jpg',
            variantLabel: 'Emergency fund',
          },
          title: 'General savings',
          variant_id: null,
        },
      })
    ).toEqual(
      expect.objectContaining({
        product_image: 'https://cdn.example.com/general.jpg',
        product_variant_label: 'Emergency fund',
        title: 'General savings',
      })
    );
  });

  it('uses snapshot metadata when product data is unavailable', () => {
    expect(
      toActiveSavingsGoal({
        goal: {
          ...activeGoal,
          product_snapshot: {
            condition: 'New',
            image_url: 'https://cdn.example.com/snapshot.jpg',
            variant_label: 'Storage: 512GB',
          },
        },
        product: null,
      })
    ).toEqual(
      expect.objectContaining({
        product_condition: 'New',
        product_image: 'https://cdn.example.com/snapshot.jpg',
        product_variant_label: 'Storage: 512GB',
      })
    );
  });

  it('uses the live selected variant label when a legacy snapshot omits color', () => {
    expect(
      toActiveSavingsGoal({
        goal: {
          ...activeGoal,
          product_snapshot: {
            condition: 'New',
            variant_label: 'Storage: 256GB',
          },
        },
        product: {
          id: 'product-1',
          images: ['https://cdn.example.com/product.jpg'],
          name: 'iPhone 15 Pro',
          variants: [
            {
              attributes: { color: 'Black', storage: '256GB' },
              condition: 'new',
              id: 'variant-1',
            },
          ],
        },
      })
    ).toEqual(
      expect.objectContaining({
        product_condition: 'New',
        product_variant_label: 'Color: Black · Storage: 256GB',
      })
    );
  });
});
