import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveReceiptLogoDataUri } from '@/lib/receipt-logo';

const baseMerchant = {
  business_name: 'Ogabassey',
  logo_url: null,
  email: 'hello@ogabassey.com',
  phone: '+2348011111111',
  support_email: 'support@ogabassey.com',
  support_phone: '+2348022222222',
  business_address: '12 Allen Avenue, Ikeja',
  cac_rc_number: null,
  tax_identification_number: null,
  legal_entity_name: null,
  brand_colors: {
    primary: '#111827',
    background: '#ffffff',
    accent: '#ef4444',
  },
  vat_registration_status: null,
  vat_rate: null,
  bank_code: null,
  bank_account_number: null,
};

describe('receipt logo safety', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it('does not fetch untrusted merchant logo URLs', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      resolveReceiptLogoDataUri({
        ...baseMerchant,
        logo_url: 'https://169.254.169.254/latest/meta-data',
      })
    ).resolves.toBeNull();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches only capped trusted media logo URLs', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: {
          'content-length': '3',
          'content-type': 'image/png',
        },
        status: 200,
      })
    );
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      resolveReceiptLogoDataUri({
        ...baseMerchant,
        logo_url: 'https://cdn.ogabassey.com/media/merchant/logo.png',
      })
    ).resolves.toBe('data:image/png;base64,AQID');

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        redirect: 'error',
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('allows existing Supabase images bucket logo URLs', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([4, 5, 6]), {
        headers: {
          'content-length': '3',
          'content-type': 'image/png',
        },
        status: 200,
      })
    );
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      resolveReceiptLogoDataUri({
        ...baseMerchant,
        logo_url:
          'https://project-ref.supabase.co/storage/v1/object/public/images/logo.png',
      })
    ).resolves.toBe('data:image/png;base64,BAUG');

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        redirect: 'error',
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('rejects Supabase logo URLs outside the public logo allowlist', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      resolveReceiptLogoDataUri({
        ...baseMerchant,
        logo_url:
          'https://project-ref.supabase.co/storage/v1/object/private/images/logo.png',
      })
    ).resolves.toBeNull();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects oversized trusted media logos before reading the body', async () => {
    const arrayBuffer = vi.fn();
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({
        'content-length': String(512 * 1024),
        'content-type': 'image/png',
      }),
      arrayBuffer,
    });
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      resolveReceiptLogoDataUri({
        ...baseMerchant,
        logo_url: 'https://cdn.ogabassey.com/media/merchant/large-logo.png',
      })
    ).resolves.toBeNull();

    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('stops streaming trusted media logos after the byte cap', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(new Uint8Array(300 * 1024), {
        headers: {
          'content-type': 'image/png',
        },
        status: 200,
      })
    );
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      resolveReceiptLogoDataUri({
        ...baseMerchant,
        logo_url: 'https://cdn.ogabassey.com/media/merchant/large-logo.png',
      })
    ).resolves.toBeNull();
  });
});
