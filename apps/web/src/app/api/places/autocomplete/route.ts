import { type NextRequest, NextResponse } from 'next/server';
import { placesAutocompleteSchema } from '@/schemas/places-autocomplete';
import {
  fetchGeoapifyPredictions,
  GeoapifyAutocompleteError,
} from '../geoapify-autocomplete';
import { fetchGoogleAutocomplete } from '../google-autocomplete';

/** Google first within the shared budget; Geoapify needs no Details lookup. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const parsed = placesAutocompleteSchema.safeParse({
    fallback: params.get('fallback') || undefined,
    input: params.get('input') || '',
    sessionToken: params.get('sessionToken') || undefined,
    country: params.get('country') || undefined,
  });
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'Invalid address search' },
      { status: 400 }
    );
  const { input, sessionToken, country } = parsed.data;
  if (input.length < 2) return NextResponse.json({ predictions: [] });

  const google = await fetchGoogleAutocomplete(input, sessionToken, country);
  if (google.status === 400 || google.body.predictions?.length) {
    return NextResponse.json(google.body, { status: google.status });
  }
  if (
    parsed.data.fallback !== 'geoapify' ||
    !process.env.GEOAPIFY_API_KEY?.trim()
  ) {
    return NextResponse.json(google.body, { status: google.status });
  }

  try {
    const predictions = await fetchGeoapifyPredictions(input, country);
    return NextResponse.json(
      { predictions },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    const status =
      error instanceof GeoapifyAutocompleteError ? error.status : 502;
    return NextResponse.json(
      {
        error:
          'Address suggestions are temporarily unavailable. Enter your full address manually.',
        code: 'ADDRESS_AUTOCOMPLETE_UNAVAILABLE',
      },
      { status, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
