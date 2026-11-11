import { builderAiEditTestFixture } from '@baci/shared/test-fixtures/builder-ai-edit';
import { expect, it, vi } from 'vitest';
import { handleBuilderAiEditRequest } from './handle-builder-ai-edit-request';

it('full-code or unknown mode rejects the real handler before any provider materialization/execution', async () => {
  for (const response of [
    { data: null, error: { message: 'FULL_CODE_ACTIVE' } },
    { data: null, error: null },
  ]) {
    const materializeProviders = vi.fn(() => {
      throw Error('PROVIDER_MUST_NOT_RUN');
    });
    const runProviderChain = vi.fn(() => {
      throw Error('PROVIDER_MUST_NOT_RUN');
    });
    const rpc = vi.fn().mockResolvedValue(response);
    const result = await handleBuilderAiEditRequest(
      new Request('http://localhost/api/builder/ai-edit', { method: 'POST' }),
      {
        dependencies: {
          authenticate: async () => ({
            supabase: { rpc } as never,
            user: { id: 'synthetic-owner' } as never,
          }),
          checkCsrf: async () => ({ valid: true }),
          getMerchant: async () => ({
            merchantId: builderAiEditTestFixture.request.merchantId,
            staffAccess: {
              isOwner: true,
              isStaff: false,
              permissions: {},
              role: null,
            },
          }),
          readBody: async () => ({
            ok: true,
            body: builderAiEditTestFixture.request,
          }),
          rateLimit: () => ({ allowed: true, remaining: 1, resetIn: 1 }),
          materializeProviders,
          runProviderChain,
        },
      }
    );
    expect(result.status).toBe(409);
    expect(materializeProviders).not.toHaveBeenCalled();
    expect(runProviderChain).not.toHaveBeenCalled();
  }
});
