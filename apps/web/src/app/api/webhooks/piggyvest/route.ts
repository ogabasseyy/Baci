export const runtime = 'nodejs';

export function GET(): Response {
  return Response.json(
    { error: 'Integration unavailable', code: 'PIGGYVEST_NOT_READY' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } }
  );
}

export function POST(): Response {
  return GET();
}
