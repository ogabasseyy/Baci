import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReceiptClaimPage, {
  generateMetadata,
  ReceiptClaimPreviewSection,
} from './page';

const mockCreateClient = vi.fn();
const mockLoadReceiptClaimPreview = vi.fn();
const mockParseReceiptClaimToken = vi.fn();
const mockRecordReceiptClaimClickBestEffort = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => mockCreateClient(),
}));

vi.mock('@/lib/import-notifications/receipt-claim-preview', () => ({
  loadReceiptClaimPreview: (...args: unknown[]) =>
    mockLoadReceiptClaimPreview(...args),
  parseReceiptClaimToken: (...args: unknown[]) =>
    mockParseReceiptClaimToken(...args),
  recordReceiptClaimClickBestEffort: (...args: unknown[]) =>
    mockRecordReceiptClaimClickBestEffort(...args),
}));

vi.mock('./receipt-claim-page-client', () => ({
  default: ({
    initialClaim,
    initialError,
    token,
  }: {
    initialClaim: { customerName: string | null } | null;
    initialError: string | null;
    token: string;
  }) => (
    <div>
      <span>token:{token}</span>
      <span>error:{initialError || 'none'}</span>
      <span>name:{initialClaim?.customerName || 'none'}</span>
    </div>
  ),
}));

function pageParams(token: string) {
  return { params: Promise.resolve({ token }) };
}

describe('ReceiptClaimPage server wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({ rpc: vi.fn() });
    mockParseReceiptClaimToken.mockReturnValue('claim-token');
    mockLoadReceiptClaimPreview.mockResolvedValue({
      claim: {
        claimed: false,
        customerName: 'Bassey John',
        devices: ['iPhone 16 Pro Max'],
        documentKind: 'receipt',
        merchantName: 'Ogabassey',
      },
      ok: true,
    });
    mockRecordReceiptClaimClickBestEffort.mockResolvedValue(undefined);
  });

  it('loads the claim preview in the async section and passes it to the client shell', async () => {
    render(await ReceiptClaimPreviewSection({ token: 'claim-token' }));

    expect(mockCreateClient).toHaveBeenCalledTimes(1);
    expect(mockLoadReceiptClaimPreview).toHaveBeenCalledWith({
      supabase: { rpc: expect.any(Function) },
      token: 'claim-token',
    });
    expect(screen.getByText('token:claim-token')).toBeInTheDocument();
    expect(screen.getByText('error:none')).toBeInTheDocument();
    expect(screen.getByText('name:Bassey John')).toBeInTheDocument();
    expect(mockRecordReceiptClaimClickBestEffort).toHaveBeenCalledWith({
      supabase: { rpc: expect.any(Function) },
      token: 'claim-token',
    });
  });

  it('still renders the claim preview after recording click tracking', async () => {
    mockRecordReceiptClaimClickBestEffort.mockRejectedValueOnce(
      new Error('tracking failed')
    );

    render(await ReceiptClaimPreviewSection({ token: 'claim-token' }));

    expect(screen.getByText('name:Bassey John')).toBeInTheDocument();
    expect(mockRecordReceiptClaimClickBestEffort).toHaveBeenCalledWith({
      supabase: { rpc: expect.any(Function) },
      token: 'claim-token',
    });
  });

  it('prevents tokenized receipt claim pages from being indexed', () => {
    expect(generateMetadata()).toMatchObject({
      robots: {
        follow: false,
        index: false,
      },
    });
  });

  it('renders an invalid-link error without creating a Supabase client', async () => {
    mockParseReceiptClaimToken.mockReturnValue(null);

    render(await ReceiptClaimPage(pageParams('bad token')));

    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(mockLoadReceiptClaimPreview).not.toHaveBeenCalled();
    expect(screen.getByText('token:')).toBeInTheDocument();
    expect(
      screen.getByText('error:Invalid receipt claim link')
    ).toBeInTheDocument();
  });

  it('passes preview errors through to the client shell', async () => {
    mockLoadReceiptClaimPreview.mockResolvedValue({
      error: 'Receipt claim link has expired',
      ok: false,
      status: 410,
    });

    render(await ReceiptClaimPreviewSection({ token: 'claim-token' }));

    expect(
      screen.getByText('error:Receipt claim link has expired')
    ).toBeInTheDocument();
    expect(screen.getByText('name:none')).toBeInTheDocument();
  });

  it('uses a generic error when the server preview load fails', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockLoadReceiptClaimPreview.mockRejectedValue(new Error('db failed'));

    render(await ReceiptClaimPreviewSection({ token: 'claim-token' }));

    expect(
      screen.getByText('error:Failed to load receipt claim')
    ).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
