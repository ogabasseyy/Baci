import { NextRequest } from 'next/server';
import { vi } from 'vitest';

// Set environment variable BEFORE importing the route
vi.stubEnv('GOOGLE_MAPS_API_KEY', 'test-api-key');

// Mock global fetch
export const mockFetch = vi.fn();
global.fetch = mockFetch;

// Import the handler AFTER mocks
export const { GET } = await import('./route');

// Helper function to create test requests
export function makeRequest(params: Record<string, string>) {
  const url = new URL('http://localhost:3000/api/places/autocomplete');
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new NextRequest(url);
}

// Helper to create mock Google API response
export function createGoogleResponse(
  suggestions: Array<{
    placeId: string;
    mainText: string;
    secondaryText?: string;
    fullText: string;
  }>
) {
  return {
    status: 'OK',
    predictions: suggestions.map((s) => ({
      place_id: s.placeId,
      structured_formatting: {
        main_text: s.mainText,
        secondary_text: s.secondaryText || '',
      },
      description: s.fullText,
    })),
  };
}
