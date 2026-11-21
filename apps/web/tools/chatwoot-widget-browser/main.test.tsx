// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

const mockRender = vi.fn();

vi.mock('react-dom/client', () => ({
  createRoot: vi.fn(() => ({ render: mockRender })),
}));

vi.mock('@/components/storefront/chatwoot-widget', () => ({
  ChatwootWidget: ({ children }: { children: unknown }) => children,
}));

describe('chatwoot-widget-browser main fixture entry', () => {
  it('mounts the synthetic tenant storefront app into #root', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    vi.stubGlobal(
      '__CHATWOOT_FIXTURE_PLATFORM_ORIGIN__',
      'https://localhost:43129'
    );
    vi.stubGlobal('__CHATWOOT_FIXTURE_TOKEN_A__', 'synthetic_token_a_1234');
    vi.stubGlobal('__CHATWOOT_FIXTURE_TOKEN_B__', 'synthetic_token_b_5678');

    await import('./main');

    expect(mockRender).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
