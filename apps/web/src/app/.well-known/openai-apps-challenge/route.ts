const challenge = 'flm8d7tnA4QxHdY5JGbpwggiDuYBl15X88UQkXYcGTA';

export function GET(request: Request): Response {
  if (new URL(request.url).hostname !== 'mcp.usebaci.com') {
    return new Response('Not Found', { status: 404 });
  }

  return new Response(challenge, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
