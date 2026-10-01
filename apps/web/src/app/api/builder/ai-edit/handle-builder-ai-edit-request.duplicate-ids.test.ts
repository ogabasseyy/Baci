import { builderAiEditTestFixture } from '@baci/shared/test-fixtures/builder-ai-edit';
import { describe, expect, it, vi } from 'vitest';
import { handleBuilderAiEditRequest } from './handle-builder-ai-edit-request';

describe('handleBuilderAiEditRequest duplicate ids', () => {
  it('rejects duplicate ids across content and zones before merchant or provider execution', async () => {
    const getMerchant = vi.fn();
    const runProviderChain = vi.fn();
    const currentConfig = {
      ...builderAiEditTestFixture.request.currentConfig,
      zones: {
        aside: [
          {
            props: { id: 'hero-1', text: 'Duplicate target' },
            type: 'Text',
          },
        ],
      },
    };
    const response = await handleBuilderAiEditRequest(
      new Request('http://localhost/api/builder/ai-edit', { method: 'POST' }),
      {
        dependencies: {
          authenticate: async () => ({
            supabase: {} as never,
            user: { id: 'user-1' } as never,
          }),
          checkCsrf: async () => ({ valid: true }),
          getMerchant,
          materializeProviders: vi.fn(),
          rateLimit: vi.fn(),
          readBody: async () => ({
            body: { ...builderAiEditTestFixture.request, currentConfig },
            ok: true as const,
          }),
          runProviderChain,
        } as never,
      }
    );

    expect(response.status).toBe(400);
    expect(getMerchant).not.toHaveBeenCalled();
    expect(runProviderChain).not.toHaveBeenCalled();
  });

  it('rejects ambiguous duplicate root legacy ids before normalization', async () => {
    const getMerchant = vi.fn();
    const runProviderChain = vi.fn();
    const currentConfig = {
      ...builderAiEditTestFixture.request.currentConfig,
      content: [
        { props: { id: ' padded ' }, type: 'Flex' },
        { props: { id: ' padded ' }, type: 'Text' },
      ],
      zones: { ' padded :children': [] },
    };
    const response = await handleBuilderAiEditRequest(
      new Request('http://localhost/api/builder/ai-edit', { method: 'POST' }),
      {
        dependencies: {
          authenticate: async () => ({
            supabase: {} as never,
            user: { id: 'user-1' } as never,
          }),
          checkCsrf: async () => ({ valid: true }),
          getMerchant,
          materializeProviders: vi.fn(),
          rateLimit: vi.fn(),
          readBody: async () => ({
            body: { ...builderAiEditTestFixture.request, currentConfig },
            ok: true as const,
          }),
          runProviderChain,
        } as never,
      }
    );

    expect(response.status).toBe(400);
    expect(getMerchant).not.toHaveBeenCalled();
    expect(runProviderChain).not.toHaveBeenCalled();
  });
});
