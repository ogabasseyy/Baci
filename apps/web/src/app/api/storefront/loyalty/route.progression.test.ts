import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CUSTOMER_ID,
  createRequest,
  createStatusResult,
  GET,
  MERCHANT_ID,
  mockOwnedCustomer,
  loyaltyMocks as mocks,
} from './route.test-helpers';

describe('GET /api/storefront/loyalty progression and catalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOwnedCustomer();
  });

  it('normalizes persisted reward types to the catalog contract', async () => {
    mocks.mockRpc.mockResolvedValue({
      data: {
        ...createStatusResult(),
        rewards: [
          {
            id: 'r-pct',
            name: 'Ten percent off',
            description: null,
            points_cost: 100,
            reward_type: 'discount_percentage',
            reward_value: 10,
          },
          {
            id: 'r-credit',
            name: 'Store credit',
            description: null,
            points_cost: 300,
            reward_type: 'store_credit',
            reward_value: 500,
          },
        ],
      },
      error: null,
    });

    const response = await GET(
      createRequest(`merchant_id=${MERCHANT_ID}&customer_id=${CUSTOMER_ID}`)
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.available_rewards).toEqual([
      {
        id: 'r-pct',
        name: 'Ten percent off',
        description: '',
        points_required: 100,
        reward_type: 'discount',
        discount_type: 'percentage',
        discount_value: 10,
        active: true,
      },
      {
        id: 'r-credit',
        name: 'Store credit',
        description: '',
        points_required: 300,
        reward_type: 'store_credit',
        discount_value: 500,
        active: true,
      },
    ]);
  });

  it('searches for the next tier after a raised threshold', async () => {
    mocks.mockRpc.mockResolvedValue({
      data: {
        ...createStatusResult(),
        lifetime_points: 500,
        current_tier: 'Silver',
        tiers: [
          { name: 'Bronze', minPoints: 0 },
          { name: 'Silver', minPoints: 5000 },
          { name: 'Gold', minPoints: 5000 },
          { name: 'Platinum', minPoints: 10000 },
        ],
      },
      error: null,
    });

    const response = await GET(
      createRequest(`merchant_id=${MERCHANT_ID}&customer_id=${CUSTOMER_ID}`)
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.tier).toBe('silver');
    expect(body.next_tier).toBe('gold');
    expect(body.points_to_next_tier).toBe(4500);
    expect(body.tier_progress).toBe(0);
  });

  it('progresses along a merchant-defined tier ladder', async () => {
    mocks.mockRpc.mockResolvedValue({
      data: {
        ...createStatusResult(),
        lifetime_points: 300,
        current_tier: 'Starter',
        tiers: [
          { name: 'Starter', minPoints: 0 },
          { name: 'VIP', minPoints: 1000 },
        ],
      },
      error: null,
    });

    const response = await GET(
      createRequest(`merchant_id=${MERCHANT_ID}&customer_id=${CUSTOMER_ID}`)
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.tier).toBe('starter');
    expect(body.next_tier).toBe('vip');
    expect(body.points_to_next_tier).toBe(700);
    expect(body.tier_progress).toBe(30);
    expect(body.tier_thresholds.starter).toBe(0);
    expect(body.tier_thresholds.vip).toBe(1000);
  });

  it('drops nameless tiers before building progression', async () => {
    mocks.mockRpc.mockResolvedValue({
      data: {
        ...createStatusResult(),
        lifetime_points: 300,
        current_tier: 'Starter',
        tiers: [
          { name: 'Starter', minPoints: 0 },
          { minPoints: 500 },
          { name: null, minPoints: 700 },
          { name: '  ', minPoints: 800 },
          { name: 'VIP', minPoints: 1000 },
        ],
      },
      error: null,
    });

    const response = await GET(
      createRequest(`merchant_id=${MERCHANT_ID}&customer_id=${CUSTOMER_ID}`)
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.next_tier).toBe('vip');
    expect(body.points_to_next_tier).toBe(700);
    expect(body.tier_thresholds['']).toBeUndefined();
  });

  it('clamps null tier thresholds to zero instead of failing', async () => {
    mocks.mockRpc.mockResolvedValue({
      data: {
        ...createStatusResult(),
        lifetime_points: 100,
        current_tier: 'Bronze',
        tiers: [
          { name: 'Bronze', minPoints: null },
          { name: 'Silver', minPoints: 1000 },
        ],
      },
      error: null,
    });

    const response = await GET(
      createRequest(`merchant_id=${MERCHANT_ID}&customer_id=${CUSTOMER_ID}`)
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.tier).toBe('bronze');
    expect(body.next_tier).toBe('silver');
    expect(body.points_to_next_tier).toBe(900);
    expect(body.tier_thresholds.bronze).toBe(0);
  });

  it('passes custom tier names through lowercased', async () => {
    mocks.mockRpc.mockResolvedValue({
      data: { ...createStatusResult(), current_tier: 'Diamond' },
      error: null,
    });

    const response = await GET(
      createRequest(`merchant_id=${MERCHANT_ID}&customer_id=${CUSTOMER_ID}`)
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.tier).toBe('diamond');
  });

  it('drops null tier entries instead of 500ing', async () => {
    mocks.mockRpc.mockResolvedValue({
      data: {
        ...createStatusResult(),
        tiers: [
          null,
          { name: 'Bronze', minPoints: 0 },
          { name: 'Silver', minPoints: 1000 },
        ],
      },
      error: null,
    });

    const response = await GET(
      createRequest(`merchant_id=${MERCHANT_ID}&customer_id=${CUSTOMER_ID}`)
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.tiers).toHaveLength(2);
    expect(body.next_tier).toBe('silver');
  });

  it('coerces numeric-string thresholds like the SQL tier calculator', async () => {
    mocks.mockRpc.mockResolvedValue({
      data: {
        ...createStatusResult(),
        tiers: [
          { name: 'Bronze', minPoints: 0 },
          { name: 'Silver', minPoints: '1000' },
        ],
      },
      error: null,
    });

    const response = await GET(
      createRequest(`merchant_id=${MERCHANT_ID}&customer_id=${CUSTOMER_ID}`)
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.tier_thresholds.silver).toBe(1000);
    expect(body.next_tier).toBe('silver');
    expect(body.points_to_next_tier).toBe(500);
  });

  it('clamps negative bonus config to zero like the enrollment RPC', async () => {
    mocks.mockRpc.mockResolvedValue({
      data: {
        ...createStatusResult(),
        signup_bonus_points: -50,
        referral_bonus_points: -100,
      },
      error: null,
    });

    const response = await GET(
      createRequest(`merchant_id=${MERCHANT_ID}&customer_id=${CUSTOMER_ID}`)
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.settings.welcome_bonus).toBe(0);
    expect(body.settings.referral_bonus_referrer).toBe(0);
    expect(body.settings.referral_bonus_referee).toBe(0);
  });
});
