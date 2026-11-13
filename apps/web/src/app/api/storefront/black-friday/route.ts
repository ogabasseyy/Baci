import { NextResponse } from 'next/server';
import { getBlackFridayProducts } from '@/lib/ogabassey-black-friday';

export async function GET() {
  try {
    const products = await getBlackFridayProducts();
    return NextResponse.json(
      { products },
      {
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  } catch {
    return NextResponse.json(
      { error: 'Black Friday products are temporarily unavailable.' },
      { status: 503 }
    );
  }
}
