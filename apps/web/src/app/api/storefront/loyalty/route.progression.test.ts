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
        reward_type: 'discount',
        discount_type: undefined,
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
});
