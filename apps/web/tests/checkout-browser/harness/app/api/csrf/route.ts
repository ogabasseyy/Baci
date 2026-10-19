import { NextResponse } from 'next/server';
export function GET() {
  const response = NextResponse.json({ token: 'fixture-csrf-token' });
  response.cookies.set('csrf-token', 'fixture-csrf-token', {
    httpOnly: false,
    path: '/',
    sameSite: 'lax',
  });
  return response;
}
