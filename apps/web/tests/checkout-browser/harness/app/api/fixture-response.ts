import { NextResponse } from 'next/server';
import { order } from '../../../setup';

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export function orderResponse() {
  return { order, amountDueToGateway: 107500 };
}

export function scenario(request: Request) {
  return new URL(request.url).searchParams.get('scenario') ?? 'success';
}
