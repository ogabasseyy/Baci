import { NextResponse } from 'next/server';

export function preflightRouteError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}
