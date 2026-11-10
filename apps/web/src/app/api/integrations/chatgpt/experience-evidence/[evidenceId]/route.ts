import { getExperienceEvidenceReader } from '@/lib/experience/evidence-runtime';
export async function GET(
  request: Request,
  context: { params: Promise<{ evidenceId: string }> }
) {
  const reader = getExperienceEvidenceReader();
  if (!reader)
    return Response.json(
      { error: 'Evidence unavailable.' },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } }
    );
  return reader(request, (await context.params).evidenceId);
}
