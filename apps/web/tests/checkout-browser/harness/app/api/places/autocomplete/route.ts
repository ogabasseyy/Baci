import { type NextRequest, NextResponse } from 'next/server';

export function GET(request: NextRequest) {
  const input = request.nextUrl.searchParams.get('input')?.trim() ?? '';
  if (input.length < 2) {
    return NextResponse.json({ predictions: [] });
  }

  return NextResponse.json({
    predictions: [
      {
        details: {
          city: 'Osogbo',
          country: 'Nigeria',
          formattedAddress: '12 Station Road, Osogbo, Osun, Nigeria',
          route: 'Station Road',
          state: 'Osun',
          streetNumber: '12',
        },
        fullText: '12 Station Road, Osogbo, Osun, Nigeria',
        mainText: '12 Station Road',
        placeId: 'geoapify:local-repair-fixture',
        provider: 'geoapify',
        secondaryText: 'Osogbo, Osun, Nigeria',
      },
    ],
  });
}
