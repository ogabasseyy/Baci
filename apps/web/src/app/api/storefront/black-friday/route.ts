import { NextResponse } from 'next/server';
import { getBlackFridayProducts } from '@/lib/ogabassey-black-friday';

export async function GET() {
  try {
    const products = await getBlackFridayProducts();
    return NextResponse.json(
      { products },
      {
        headers: {
          'Cache-Control':
            process.env.NODE_ENV === 'development'
              ? 'no-store'
              : 'public, s-maxage=60, stale-while-revalidate=120',
        },
      }
    );
  } catch {
    return NextResponse.json(
      { error: 'Black Friday products are temporarily unavailable.' },
      { status: 503 }
    );
  }
}
