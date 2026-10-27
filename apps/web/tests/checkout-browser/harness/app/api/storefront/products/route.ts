import { NextResponse } from 'next/server';

export function GET() {
  return NextResponse.json({
    products: [
      {
        brand: 'Apple',
        category: 'Smartphones',
        id: 'product-iphone-15',
        image: '/phone.svg',
        name: 'iPhone 15',
      },
    ],
  });
}
