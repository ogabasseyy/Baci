import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { checkCsrfProtection } from '@/lib/csrf';
import { readBoundedJsonBody } from '@/lib/events/read-bounded-json-body';
import { requestDraftApply } from '@/lib/experience/draft-apply';
import { requestExperienceModeExit } from '@/lib/experience/mode-exit-service';
import { resolveExperienceOwnerRequest } from '@/lib/experience/owner-request';
import { requestExperiencePublication } from '@/lib/experience/publication-service';
import { experienceModeExitInput } from '@/schemas/experience-mode-exit';
import { experienceApplyInput } from '@/schemas/experience-publication';
import { experienceToolInputs } from '@/schemas/experience-tools';

const schema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('apply'),
    merchantId: z.uuid(),
    input: experienceApplyInput,
  }),
  z.strictObject({
    action: z.literal('publish'),
    merchantId: z.uuid(),
    input: experienceToolInputs.publish_experience,
  }),
  z.strictObject({
    action: z.literal('rollback'),
    merchantId: z.uuid(),
    input: experienceToolInputs.rollback_experience,
  }),
  z.strictObject({
    action: z.literal('mode-exit'),
    merchantId: z.uuid(),
    input: experienceModeExitInput,
  }),
]);
export async function POST(request: NextRequest) {
  const headers = { 'Cache-Control': 'private, no-store' };
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid)
    return Response.json({ error: 'Forbidden' }, { status: 403, headers });
  const body = await readBoundedJsonBody(request, 4096);
  const p = body.ok ? schema.safeParse(body.body) : null;
  if (!p?.success)
    return Response.json(
      { error: 'Invalid intent request.' },
      { status: 400, headers }
    );
  try {
    const v = p.data;
    const ctx = await resolveExperienceOwnerRequest(v.merchantId);
    if ('storefrontId' in v.input && v.input.storefrontId !== ctx.merchantId)
      throw Error();
    const result =
      v.action === 'apply'
        ? await requestDraftApply(ctx, v.input)
        : v.action === 'mode-exit'
          ? await requestExperienceModeExit(ctx, v.input)
          : await requestExperiencePublication(ctx, v.input, v.action);
    return Response.json(result, { headers });
  } catch {
    return Response.json(
      { error: 'Intent unavailable.' },
      { status: 403, headers }
    );
  }
}
