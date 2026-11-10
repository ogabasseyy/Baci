import type { NextRequest } from 'next/server';
import { checkCsrfProtection } from '@/lib/csrf';
import { readBoundedJsonBody } from '@/lib/events/read-bounded-json-body';
import {
  authenticateExperienceOwnerRequest,
  resolveExperienceOwnerRequest,
} from '@/lib/experience/owner-request';
import { patchSource, readSource } from '@/lib/experience/source-service';
import { experienceToolInputs } from '@/schemas/experience-tools';

const headers = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};
export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams;
    const input = experienceToolInputs.read_experience.parse({
      storefrontId: q.get('merchant'),
      operation: 'read',
      artifactId: q.get('artifact'),
      path: q.get('path'),
      byteOffset: Number(q.get('offset') ?? 0),
      maxBytes: Number(q.get('maxBytes') ?? 8192),
    });
    if (input.operation !== 'read') throw Error();
    const ctx = await resolveExperienceOwnerRequest(input.storefrontId);
    if (q.get('download') === '1') {
      const r = await ctx.supabase
        .from('experience_source_files')
        .select('content')
        .eq('merchant_id', ctx.merchantId)
        .eq('artifact_id', input.artifactId)
        .eq('path', input.path)
        .maybeSingle();
      if (
        r.error ||
        typeof r.data?.content !== 'string' ||
        Buffer.byteLength(r.data.content) > 524288
      )
        throw Error();
      return new Response(r.data.content, {
        headers: {
          ...headers,
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename="${input.path.split('/').at(-1)}"`,
        },
      });
    }
    return Response.json(await readSource(ctx, input), { headers });
  } catch {
    return Response.json(
      { error: 'Source unavailable.' },
      { status: 403, headers }
    );
  }
}
export async function POST(request: NextRequest) {
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid)
    return Response.json({ error: 'Forbidden' }, { status: 403, headers });
  try {
    const resolveOwner = await authenticateExperienceOwnerRequest();
    const body = await readBoundedJsonBody(request, 4194304);
    if (!body.ok)
      return Response.json(
        { error: 'Invalid source request.' },
        { status: 400, headers }
      );
    const parsed = experienceToolInputs.read_experience.safeParse(body.body);
    if (!parsed.success || parsed.data.operation !== 'patch')
      return Response.json(
        { error: 'Invalid source request.' },
        { status: 400, headers }
      );
    const { storefrontId, operation: _, ...input } = parsed.data;
    const ctx = await resolveOwner(storefrontId);
    return Response.json(await patchSource(ctx, input), { headers });
  } catch {
    return Response.json(
      { error: 'Source unavailable.' },
      { status: 403, headers }
    );
  }
}
