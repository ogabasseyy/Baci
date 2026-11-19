import type { NextRequest } from 'next/server';
import { checkCsrfProtection } from '@/lib/csrf';
import { readBoundedJsonBody } from '@/lib/events/read-bounded-json-body';
import { requestDraftApply } from '@/lib/experience/draft-apply';
import { requestExperienceModeExit } from '@/lib/experience/mode-exit-service';
import { authenticateExperienceOwnerRequest } from '@/lib/experience/owner-request';
import { requestExperiencePublication } from '@/lib/experience/publication-service';
import { experienceOwnerIntentInput } from '@/schemas/experience-owner-intent';

export async function POST(request: NextRequest) {
  const headers = { 'Cache-Control': 'private, no-store' };
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid)
    return Response.json({ error: 'Forbidden' }, { status: 403, headers });
  try {
    const resolveOwner = await authenticateExperienceOwnerRequest();
    const body = await readBoundedJsonBody(request, 4096);
    const p = body.ok ? experienceOwnerIntentInput.safeParse(body.body) : null;
    if (!p?.success)
      return Response.json(
        { error: 'Invalid intent request.' },
        { status: 400, headers }
      );
    const v = p.data;
    const ctx = await resolveOwner(v.merchantId);
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
