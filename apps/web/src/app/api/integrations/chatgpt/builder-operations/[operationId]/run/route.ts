import { BUILDER_PRIVATE_STORAGE_ENABLED } from '@/config/builder-private-storage';
import { checkBuilderAiRateLimit } from '@/lib/builder-ai/builder-ai-rate-limit';
import { claimStorefrontEdit } from '@/lib/website-builder/claim-edit';
import { createEditExecutionHandler } from '@/lib/website-builder/edit-execution';
import { authenticateEditUser } from '@/lib/website-builder/edit-user';
import { generateStorefrontEdit } from '@/lib/website-builder/generate-edit';
import { runStorefrontEdit } from '@/lib/website-builder/run-edit';
export const maxDuration = 60;
export async function POST(
  request: Request,
  context: { params: Promise<{ operationId: string }> }
) {
  if (!BUILDER_PRIVATE_STORAGE_ENABLED)
    return Response.json(
      { error: 'Builder execution is not enabled.' },
      { status: 503 }
    );
  const handler = createEditExecutionHandler({
    authenticate: authenticateEditUser,
    execute: async (ctx, id) => {
      const lease = await claimStorefrontEdit(ctx, id);
      if (lease)
        await runStorefrontEdit(ctx, lease, {
          generate: generateStorefrontEdit,
          rateLimit: checkBuilderAiRateLimit,
        });
    },
  });
  return handler(request, (await context.params).operationId);
}
