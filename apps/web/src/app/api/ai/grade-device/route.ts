import { GoogleGenerativeAI } from '@google/generative-ai';
import { type NextRequest, NextResponse } from 'next/server';
import { checkCsrfProtection } from '@/lib/csrf';
import { deviceGradingAiResultSchema } from '@/schemas/device-grading';
import { estimateTradeInValue } from './estimate-trade-in-value';
import {
  type DeviceMediaPart,
  encodeDeviceMedia,
  readDeviceMedia,
} from './read-device-media';
import { resolveDeviceCheckStorefront } from './resolve-device-check-storefront';

export const maxDuration = 60;

const GRADING_MODEL = 'gemini-3-flash-preview';

const GRADING_PROMPT = `
You are an expert mobile device grader. The attached media shows one device.
1. Identify the exact model (e.g. "iPhone 13 Pro", "Samsung S22 Ultra").
2. Grade the cosmetic condition based on VISIBLE flaws (screen cracks, scratches, dents).
   - "Excellent": Near perfect.
   - "Good": Minor scratches, no cracks.
   - "Fair": Visible scratches or minor dents.
   - "Poor": Cracked screen, heavy damage.
3. List 2-3 specific visual observations supporting your grade.

Return ONLY valid JSON in this format:
{
  "model": "Identified Model Name",
  "grade": "Excellent" | "Good" | "Fair" | "Poor",
  "observations": ["observation 1", "observation 2"]
}
`;

function errorResponse(error: string, status: number, code?: string) {
  return NextResponse.json({ error, ...(code ? { code } : {}) }, { status });
}

async function gradeDevice(parts: DeviceMediaPart[]): Promise<string> {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Device grading is not configured');

  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model: GRADING_MODEL,
  });
  const result = await model.generateContent([
    GRADING_PROMPT,
    ...parts.map((part) => ({ inlineData: part })),
  ]);
  return result.response
    .text()
    .replace(/```json|```/g, '')
    .trim();
}

/** Malformed model output is `undefined`, which the schema then rejects. */
function parseGrading(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * POST /api/ai/grade-device — anonymous storefront device check, called by
 * the web storefront (cookies + CSRF token) and the mobile app (neither).
 * The proxy enforces this path's per-IP budget (see rate-limit-routes.ts).
 */
export async function POST(request: NextRequest) {
  try {
    // Double-submit CSRF only when the request carries cookies, mirroring
    // /api/search/assist: the native app posts no cookies and has no ambient
    // authority to abuse, while a cross-site page must not deputize a
    // shopper's browser into spending the AI budget. The web page sends the
    // token via fetchWithCsrf.
    if (request.headers.get('cookie')) {
      const { valid, response } = await checkCsrfProtection(request);
      if (!valid) {
        return response ?? errorResponse('CSRF validation failed', 403);
      }
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return errorResponse('Invalid upload', 400, 'INVALID_UPLOAD');
    }

    const media = readDeviceMedia(formData);
    if (!media.ok) return errorResponse(media.error, media.status);

    // The price lookup must stay inside the store the request came from.
    const storefront = await resolveDeviceCheckStorefront(
      request,
      media.merchantSlug
    );
    if (!storefront.ok) {
      return errorResponse(
        storefront.error,
        storefront.status,
        'STOREFRONT_NOT_FOUND'
      );
    }

    let rawGrading: unknown;
    try {
      rawGrading = parseGrading(
        await gradeDevice(await encodeDeviceMedia(media.files))
      );
    } catch (error) {
      console.error(
        '[grade-device] analysis failed:',
        error instanceof Error ? error.message : 'unknown error'
      );
      return errorResponse(
        'We could not check this device right now. Please try again.',
        502,
        'ANALYSIS_FAILED'
      );
    }

    const grading = deviceGradingAiResultSchema.safeParse(rawGrading);
    if (!grading.success) {
      return errorResponse(
        'We could not recognise the device. Please record a clearer video.',
        502,
        'ANALYSIS_UNREADABLE'
      );
    }

    const estimate = await estimateTradeInValue(
      storefront.merchantId,
      grading.data
    );

    return NextResponse.json({
      success: true,
      data: { ...grading.data, ...estimate },
    });
  } catch (error) {
    console.error(
      '[grade-device] unexpected error:',
      error instanceof Error ? error.message : 'unknown error'
    );
    return errorResponse('Internal server error', 500);
  }
}
