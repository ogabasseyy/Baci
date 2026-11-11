import sharp from 'sharp';
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
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it('rejects a compressed logo with oversized decoded dimensions', async () => {
    const header = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==',
      'base64'
    );
    header.writeUInt32BE(100_000, 16);
    header.writeUInt32BE(100_000, 20);
    await expect(
      resolveReceiptLogoDataUri({
        ...baseMerchant,
        logo_url: `data:image/png;base64,${header.toString('base64')}`,
      })
    ).resolves.toBeNull();
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
      new Response(
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==',
          'base64'
        ),
        {
          headers: {
            'content-type': 'image/png',
          },
          status: 200,
        }
      )
    );
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      resolveReceiptLogoDataUri({
        ...baseMerchant,
        logo_url: 'https://cdn.ogabassey.com/media/merchant/logo.png',
      })
    ).resolves.toBe(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg=='
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        redirect: 'error',
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('accepts a verified raster when a trusted origin returns octet-stream', async () => {
    const png = await sharp({
      create: { width: 1, height: 1, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(png, {
          headers: { 'content-type': 'application/octet-stream' },
        })
      )
    );
    await expect(
      resolveReceiptLogoDataUri({
        ...baseMerchant,
        logo_url: 'https://cdn.ogabassey.com/media/logo.png',
      })
    ).resolves.toBe(`data:image/png;base64,${png.toString('base64')}`);
  });

  it('normalizes a fetched image/jpg logo to the standard JPEG MIME', async () => {
    const jpeg = await sharp({
      create: { width: 1, height: 1, channels: 3, background: '#ffffff' },
    })
      .jpeg()
      .toBuffer();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(jpeg, { headers: { 'content-type': 'image/jpg' } })
        )
    );

    await expect(
      resolveReceiptLogoDataUri({
        ...baseMerchant,
        logo_url: 'https://cdn.ogabassey.com/media/logo.jpg',
      })
    ).resolves.toBe(`data:image/jpeg;base64,${jpeg.toString('base64')}`);
  });

  it('allows existing Supabase images bucket logo URLs', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project-ref.supabase.co');
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==',
          'base64'
        ),
        {
          headers: {
            'content-type': 'image/png',
          },
          status: 200,
        }
      )
    );
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      resolveReceiptLogoDataUri({
        ...baseMerchant,
        logo_url:
          'https://project-ref.supabase.co/storage/v1/object/public/images/logo.png',
      })
    ).resolves.toBe(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg=='
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        redirect: 'error',
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('rejects a public logo from a different Supabase project', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project-ref.supabase.co');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(
      resolveReceiptLogoDataUri({
        ...baseMerchant,
        logo_url:
          'https://other.supabase.co/storage/v1/object/public/images/logo.png',
      })
    ).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a configured storage logo on a nonstandard port', async () => {
    vi.stubEnv(
      'NEXT_PUBLIC_SUPABASE_URL',
      'https://project-ref.supabase.co:8443'
    );
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(
      resolveReceiptLogoDataUri({
        ...baseMerchant,
        logo_url:
          'https://project-ref.supabase.co:8443/storage/v1/object/public/images/logo.png',
      })
    ).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
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
    const getReader = vi.fn();
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({
        'content-length': String(512 * 1024),
        'content-type': 'image/png',
      }),
      body: { getReader },
    });
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      resolveReceiptLogoDataUri({
        ...baseMerchant,
        logo_url: 'https://cdn.ogabassey.com/media/merchant/large-logo.png',
      })
    ).resolves.toBeNull();

    expect(getReader).not.toHaveBeenCalled();
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
