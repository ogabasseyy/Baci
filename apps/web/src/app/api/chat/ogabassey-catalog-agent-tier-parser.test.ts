import { describe, expect, it } from 'vitest';
import { collectModelAttachedTierTokens } from './ogabassey-catalog-agent-tier-parser';

describe('ogabassey-catalog-agent-tier-parser', () => {
  it('captures model-attached tiers while ignoring prose uses of shared words', () => {
    expect([
      ...collectModelAttachedTierTokens(
        'Apple iPhone 16 Pro Max is ₦1,400,000',
        new Set(['apple', 'iphone', '16'])
      ),
    ]).toEqual(['pro', 'max']);

    expect([
      ...collectModelAttachedTierTokens(
        'Samsung Galaxy S25 fits your max budget',
        new Set(['samsung', 'galaxy', 's25'])
      ),
    ]).toEqual([]);

    expect([
      ...collectModelAttachedTierTokens(
        'HP Pavilion Laptop plus charger is available',
        new Set(['hp', 'pavilion', 'laptop'])
      ),
    ]).toEqual([]);

    expect([
      ...collectModelAttachedTierTokens(
        'Sony WH-1000XM5 headphones for studio use',
        new Set(['sony', 'wh', '1000xm5'])
      ),
    ]).toEqual([]);

    expect([
      ...collectModelAttachedTierTokens(
        'Apple MacBook Air M2',
        new Set(['apple', 'macbook', 'pro', 'm2'])
      ),
    ]).toEqual(['air', 'm2']);

    expect([
      ...collectModelAttachedTierTokens(
        'Apple iPhone 16 offers 256GB plus 8GB RAM',
        new Set(['apple', 'iphone', '16', '256gb'])
      ),
    ]).toEqual([]);

    expect([
      ...collectModelAttachedTierTokens(
        'Motorola Edge 50 plus 256GB',
        new Set(['motorola', 'edge', '50'])
      ),
    ]).toEqual(['edge', 'plus']);

    expect([
      ...collectModelAttachedTierTokens(
        'Samsung Galaxy A15 5G ultra',
        new Set(['samsung', 'galaxy', 'a15', '5g'])
      ),
    ]).toEqual(['ultra']);

    expect([
      ...collectModelAttachedTierTokens(
        'Samsung Galaxy S25 has Bluetooth 5 plus 8GB RAM',
        new Set(['samsung', 'galaxy', 's25'])
      ),
    ]).toEqual([]);

    expect([
      ...collectModelAttachedTierTokens(
        'Samsung Galaxy S25 offers 5G ultra-fast connectivity',
        new Set(['samsung', 'galaxy', 's25'])
      ),
    ]).toEqual([]);

    expect([
      ...collectModelAttachedTierTokens(
        'Apple iPad Air has an M2 chip',
        new Set(['apple', 'ipad', 'air'])
      ),
    ]).toEqual(['air']);

    expect([
      ...collectModelAttachedTierTokens(
        'Apple iPhone 16 offers 256 GB plus 8 GB RAM',
        new Set(['apple', 'iphone', '16'])
      ),
    ]).toEqual([]);
  });
});
