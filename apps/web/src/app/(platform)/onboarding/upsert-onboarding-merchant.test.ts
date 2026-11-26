import { describe, expect, it, vi } from 'vitest';
import {
  OnboardingSlugUnavailableError,
  upsertOnboardingMerchant,
} from './upsert-onboarding-merchant';

describe('upsertOnboardingMerchant', () => {
  it('creates a web merchant with the authenticated owner and generated slug', async () => {
    const single = vi.fn().mockResolvedValue({
      data: { id: 'merchant-1', slug: 'baci-food' },
      error: null,
    });
    const insert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ single }),
    });
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ maybeSingle }),
        }),
        insert,
      }),
      rpc: vi.fn().mockResolvedValue({ data: 'baci-food', error: null }),
    };

    const result = await upsertOnboardingMerchant({
      supabase: supabase as never,
      user: { id: 'user-1' } as never,
      email: 'merchant@example.com',
      businessName: 'Baci Food',
      businessType: 'food',
      country: 'NG',
      logoUrl: 'https://example.com/logo.png',
      brandColors: null,
      brandColorsParsed: false,
    });

    expect(result).toMatchObject({
      status: 'saved',
      merchant: { id: 'merchant-1' },
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        signup_source: 'web',
        slug: 'baci-food',
      })
    );
  });

  it('fails closed before slug RPC or writes when the owner-scoped lookup fails', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'RLS transient failure' },
    });
    const insert = vi.fn();
    const rpc = vi.fn();
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ maybeSingle }),
        }),
        insert,
      }),
      rpc,
    };

    await expect(
      upsertOnboardingMerchant({
        supabase: supabase as never,
        user: { id: 'user-1' } as never,
        email: 'merchant@example.com',
        businessName: 'Baci Food',
        businessType: 'food',
        country: 'NG',
        brandColors: null,
        brandColorsParsed: false,
      })
    ).rejects.toThrow('Could not load your store setup. Please try again.');
    expect(rpc).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it.each([
    null,
    '   ',
  ])('uses a legacy-neutral type for a completed merchant with persisted type %j', async (persistedBusinessType) => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'merchant-1',
        business_name: 'Persisted Store',
        business_type: persistedBusinessType,
        slug: 'persisted-store',
      },
      error: null,
    });
    const rpc = vi.fn();
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ maybeSingle }),
        }),
      }),
      rpc,
    };

    const result = await upsertOnboardingMerchant({
      supabase: supabase as never,
      user: { id: 'user-1' } as never,
      email: 'merchant@example.com',
      businessName: 'Conflicting Submission',
      businessType: 'fashion',
      country: 'NG',
      brandColors: null,
      brandColorsParsed: false,
    });

    expect(result).toMatchObject({
      status: 'completed',
      businessName: 'Persisted Store',
      businessType: 'general',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('honors custom slug, persists trimmed phone, and normalizes empty logoUrl to null on insert', async () => {
    const single = vi.fn().mockResolvedValue({
      data: { id: 'merchant-1', slug: 'kicks-hub', logo_url: null },
      error: null,
    });
    const insert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ single }),
    });
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const rpc = vi.fn();
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ maybeSingle }),
        }),
        insert,
      }),
      rpc,
    };

    const result = await upsertOnboardingMerchant({
      supabase: supabase as never,
      user: { id: 'user-1' } as never,
      email: 'merchant@example.com',
      businessName: 'Kicks Hub',
      businessType: 'fashion',
      country: 'NG',
      logoUrl: '   ',
      phone: ' +2348012345678 ',
      slug: ' Kicks-Hub ',
      slugIsCustom: true,
      brandColors: null,
      brandColorsParsed: false,
    });

    expect(result).toMatchObject({
      status: 'saved',
      merchant: { id: 'merchant-1', slug: 'kicks-hub' },
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'kicks-hub',
        phone: '+2348012345678',
        logo_url: null,
        favicon_png_192_url: null,
      })
    );
  });

  it('routes custom slug changes for an incomplete merchant with an established draft slug through rename_merchant_slug RPC and omits slug from direct update', async () => {
    const single = vi.fn().mockResolvedValue({
      data: { id: 'merchant-1', slug: 'fresh-custom', logo_url: null },
      error: null,
    });
    const update = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({ single }),
        }),
      }),
    });
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'merchant-1', business_name: null, slug: 'old-draft' },
      error: null,
    });
    const rpc = vi.fn().mockResolvedValue({
      data: { slug: 'fresh-custom', retired_slug: 'old-draft' },
      error: null,
    });
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ maybeSingle }),
        }),
        update,
      }),
      rpc,
    };

    const result = await upsertOnboardingMerchant({
      supabase: supabase as never,
      user: { id: 'user-1' } as never,
      email: 'merchant@example.com',
      businessName: 'Fresh Custom',
      businessType: 'fashion',
      country: 'NG',
      logoUrl: '',
      phone: '   ',
      slug: 'fresh-custom',
      slugIsCustom: true,
      brandColors: null,
      brandColorsParsed: false,
    });

    expect(rpc).toHaveBeenCalledWith('rename_merchant_slug', {
      p_merchant_id: 'merchant-1',
      p_new_slug: 'fresh-custom',
    });
    const updatePayload = update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(updatePayload).toMatchObject({
      logo_url: null,
      favicon_png_192_url: null,
      phone: null,
    });
    expect(updatePayload).not.toHaveProperty('slug');
    expect(result).toMatchObject({
      status: 'saved',
      retiredSlug: 'old-draft',
    });
  });

  it('writes custom slug directly when updating an incomplete merchant with no established slug', async () => {
    const single = vi.fn().mockResolvedValue({
      data: { id: 'merchant-1', slug: 'fresh-custom', logo_url: null },
      error: null,
    });
    const update = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({ single }),
        }),
      }),
    });
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'merchant-1', business_name: null, slug: null },
      error: null,
    });
    const rpc = vi.fn();
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ maybeSingle }),
        }),
        update,
      }),
      rpc,
    };

    await upsertOnboardingMerchant({
      supabase: supabase as never,
      user: { id: 'user-1' } as never,
      email: 'merchant@example.com',
      businessName: 'Fresh Custom',
      businessType: 'fashion',
      country: 'NG',
      logoUrl: '',
      phone: '   ',
      slug: 'fresh-custom',
      slugIsCustom: true,
      brandColors: null,
      brandColorsParsed: false,
    });

    expect(rpc).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'fresh-custom' })
    );
  });

  it('routes a confirmed auto slug through rename_merchant_slug when an incomplete draft merchant has a different established slug', async () => {
    const single = vi.fn().mockResolvedValue({
      data: { id: 'merchant-1', slug: 'kicks-hub', logo_url: null },
      error: null,
    });
    const update = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({ single }),
        }),
      }),
    });
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'merchant-1', business_name: null, slug: 'mobile-draft-1' },
      error: null,
    });
    const rpc = vi.fn().mockResolvedValue({
      data: { slug: 'kicks-hub', retired_slug: 'mobile-draft-1' },
      error: null,
    });
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ maybeSingle }),
        }),
        update,
      }),
      rpc,
    };

    const result = await upsertOnboardingMerchant({
      supabase: supabase as never,
      user: { id: 'user-1' } as never,
      email: 'merchant@example.com',
      businessName: 'Kicks Hub',
      businessType: 'fashion',
      country: 'NG',
      slug: 'kicks-hub',
      slugIsCustom: false,
      brandColors: null,
      brandColorsParsed: false,
    });

    expect(rpc).toHaveBeenCalledWith('rename_merchant_slug', {
      p_merchant_id: 'merchant-1',
      p_new_slug: 'kicks-hub',
    });
    const updatePayload = update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(updatePayload).not.toHaveProperty('slug');
    expect(result).toMatchObject({
      status: 'saved',
      retiredSlug: 'mobile-draft-1',
    });
  });

  it('uses auto-generated slug when slugIsCustom is false even if slug is provided', async () => {
    const single = vi.fn().mockResolvedValue({
      data: { id: 'merchant-1', slug: 'kicks-hub-2' },
      error: null,
    });
    const insert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ single }),
    });
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const rpc = vi.fn().mockResolvedValue({ data: 'kicks-hub-2', error: null });
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ maybeSingle }),
        }),
        insert,
      }),
      rpc,
    };

    await upsertOnboardingMerchant({
      supabase: supabase as never,
      user: { id: 'user-1' } as never,
      email: 'merchant@example.com',
      businessName: 'Kicks Hub',
      businessType: 'fashion',
      country: 'NG',
      slug: 'ignored-slug',
      slugIsCustom: false,
      brandColors: null,
      brandColorsParsed: false,
    });

    expect(rpc).toHaveBeenCalledWith('generate_slug', {
      text_input: 'Kicks Hub',
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'kicks-hub-2' })
    );
  });

  it.each([
    'admin',
    'chat',
    'API',
    'onboarding',
  ])('rejects reserved custom slug %s with OnboardingSlugUnavailableError before writing', async (reservedSlug) => {
    const insert = vi.fn();
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ maybeSingle }),
        }),
        insert,
      }),
      rpc: vi.fn(),
    };

    await expect(
      upsertOnboardingMerchant({
        supabase: supabase as never,
        user: { id: 'user-1' } as never,
        email: 'merchant@example.com',
        businessName: 'My Store',
        businessType: 'fashion',
        country: 'NG',
        slug: reservedSlug,
        slugIsCustom: true,
        brandColors: null,
        brandColorsParsed: false,
      })
    ).rejects.toBeInstanceOf(OnboardingSlugUnavailableError);
    expect(insert).not.toHaveBeenCalled();
  });

  it('maps slug 23505 unique violations to OnboardingSlugUnavailableError', async () => {
    const single = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: '23505',
        message:
          'duplicate key value violates unique constraint "idx_merchants_slug"',
        details: 'Key (slug)=(kicks-hub) already exists.',
      },
    });
    const insert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ single }),
    });
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ maybeSingle }),
        }),
        insert,
      }),
      rpc: vi.fn(),
    };

    await expect(
      upsertOnboardingMerchant({
        supabase: supabase as never,
        user: { id: 'user-1' } as never,
        email: 'merchant@example.com',
        businessName: 'Kicks Hub',
        businessType: 'fashion',
        country: 'NG',
        slug: 'kicks-hub',
        slugIsCustom: true,
        brandColors: null,
        brandColorsParsed: false,
      })
    ).rejects.toBeInstanceOf(OnboardingSlugUnavailableError);
  });

  it('does not misreport a non-slug 23505 unique violation as OnboardingSlugUnavailableError', async () => {
    const single = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: '23505',
        message:
          'duplicate key value violates unique constraint "merchants_user_id_key"',
        details: 'Key (user_id)=(user-1) already exists.',
      },
    });
    const insert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ single }),
    });
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ maybeSingle }),
        }),
        insert,
      }),
      rpc: vi.fn(),
    };

    const promise = upsertOnboardingMerchant({
      supabase: supabase as never,
      user: { id: 'user-1' } as never,
      email: 'merchant@example.com',
      businessName: 'Kicks Hub',
      businessType: 'fashion',
      country: 'NG',
      slug: 'kicks-hub',
      slugIsCustom: true,
      brandColors: null,
      brandColorsParsed: false,
    });

    await expect(promise).rejects.toThrow('Merchant creation failed');
    await expect(promise).rejects.not.toBeInstanceOf(
      OnboardingSlugUnavailableError
    );
  });
});
