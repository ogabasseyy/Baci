import { render, screen } from '@testing-library/react';
import { renderToReadableStream } from 'react-dom/server.edge';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  approvalRuntime: false,
  user: { id: 'owner-1' } as { id: string } | null,
  merchant: { merchantId: '11111111-1111-4111-8111-111111111111' } as {
    merchantId: string;
  } | null,
  mode: 'legacy' as 'legacy' | 'full-code' | 'unavailable',
  redirect: vi.fn(),
  getUser: vi.fn(),
  getMerchant: vi.fn(),
  readMode: vi.fn(),
}));

import BuilderPage from './page';

const mockBuilderClient = vi.fn(() => <div data-testid="builder-client" />);

vi.mock('@/components/csrf-initializer', () => ({
  CsrfInitializer: () => <div data-testid="csrf-initializer" />,
}));

vi.mock('@/hooks/merchant/merchant-provider', () => ({
  MerchantProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="merchant-provider">{children}</div>
  ),
}));

vi.mock('@/contexts/storefront-context', () => ({
  StorefrontProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="storefront-provider">{children}</div>
  ),
}));

vi.mock('@/components/builder/copilot-builder-wrapper', () => ({
  CopilotBuilderWrapper: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="copilot-builder-wrapper">{children}</div>
  ),
}));

vi.mock('./builder-client', () => ({
  default: () => mockBuilderClient(),
}));

vi.mock('@/lib/experience/owner-runtime', () => ({
  getExperienceOwnerRuntime: () =>
    state.approvalRuntime ? { approval: {} } : undefined,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: state.getUser } }),
}));

vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: state.getMerchant,
}));

vi.mock('@/lib/experience/authoring-mode', () => ({
  readExperienceAuthoringMode: state.readMode,
}));

vi.mock('next/navigation', () => ({
  redirect: (...args: unknown[]) => state.redirect(...args),
}));

async function renderPageToHtml() {
  const stream = await renderToReadableStream(<BuilderPage />);
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let html = '';
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) return html;
    html += decoder.decode(chunk.value, { stream: true });
  }
}

describe('BuilderPage', () => {
  beforeEach(() => {
    mockBuilderClient.mockReset();
    mockBuilderClient.mockImplementation(() => (
      <div data-testid="builder-client" />
    ));
    state.approvalRuntime = false;
    state.user = { id: 'owner-1' };
    state.merchant = { merchantId: '11111111-1111-4111-8111-111111111111' };
    state.mode = 'legacy';
    state.redirect.mockReset();
    state.getUser.mockReset().mockResolvedValue({
      data: { user: state.user },
      error: null,
    });
    state.getMerchant.mockReset().mockResolvedValue(state.merchant);
    state.readMode.mockReset().mockResolvedValue(state.mode);
  });

  it('mounts CsrfInitializer for builder mutations', () => {
    render(<BuilderPage />);

    expect(screen.getByTestId('csrf-initializer')).toBeInTheDocument();
    expect(screen.getByTestId('builder-client')).toBeInTheDocument();
  });

  it('renders a local fallback while the builder client is pending', () => {
    mockBuilderClient.mockImplementation(() => {
      throw new Promise(() => {
        // Intentionally never resolves to keep the local fallback visible.
      });
    });

    render(<BuilderPage />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading builder');
  });

  it('renders the legacy builder when approval runtime is off', async () => {
    const html = await renderPageToHtml();

    expect(html).toContain('data-testid="builder-client"');
    expect(state.getUser).not.toHaveBeenCalled();
  });

  it('redirects an authenticated owner in full-code mode to their workspace', async () => {
    state.approvalRuntime = true;
    state.mode = 'full-code';
    state.readMode.mockResolvedValue('full-code');

    await renderPageToHtml();

    expect(state.redirect).toHaveBeenCalledWith(
      '/builder/experience?merchant=11111111-1111-4111-8111-111111111111'
    );
    expect(state.readMode).toHaveBeenCalledWith(
      expect.anything(),
      '11111111-1111-4111-8111-111111111111'
    );
  });

  it('renders an unavailable alert for an owner when authoring mode is unavailable', async () => {
    state.approvalRuntime = true;
    state.mode = 'unavailable';
    state.readMode.mockResolvedValue('unavailable');

    const html = await renderPageToHtml();

    expect(html).toContain('role="alert"');
    expect(html).toContain(
      'Builder mode is unavailable. Refresh before editing.'
    );
    expect(state.redirect).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'when the user is missing', user: null, merchant: true },
    {
      name: 'when the merchant is missing',
      user: { id: 'owner-1' },
      merchant: false,
    },
  ])('falls through to the legacy builder $name', async ({
    user,
    merchant,
  }) => {
    state.approvalRuntime = true;
    state.user = user;
    state.merchant = merchant
      ? { merchantId: '11111111-1111-4111-8111-111111111111' }
      : null;
    state.getUser.mockResolvedValue({ data: { user }, error: null });
    state.getMerchant.mockResolvedValue(state.merchant);

    const html = await renderPageToHtml();

    expect(html).toContain('data-testid="builder-client"');
    if (!user) expect(state.getMerchant).not.toHaveBeenCalled();
    expect(state.readMode).not.toHaveBeenCalled();
  });

  it('falls through to the legacy builder in legacy mode', async () => {
    state.approvalRuntime = true;
    state.mode = 'legacy';
    state.readMode.mockResolvedValue('legacy');

    const html = await renderPageToHtml();

    expect(html).toContain('data-testid="builder-client"');
    expect(state.redirect).not.toHaveBeenCalled();
  });
});
