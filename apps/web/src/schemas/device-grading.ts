import { z } from 'zod';

export const DEVICE_GRADES = ['Excellent', 'Good', 'Fair', 'Poor'] as const;

/** Still frames a client may send for one device check. */
export const DEVICE_GRADING_MAX_FRAMES = 6;

/**
 * Total media budget for one device check. The API proxy rejects any request
 * whose Content-Length is above 2 MiB before the route runs (and the hosting
 * platform rejects ~4.5 MB), so the route and its clients share this lower
 * ceiling, which leaves room for multipart overhead, and explain the limit
 * themselves.
 */
export const DEVICE_GRADING_MAX_UPLOAD_BYTES = 1_900_000;

export const DEVICE_GRADING_FRAME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

/** What the model must return before any price is looked up. */
export const deviceGradingAiResultSchema = z.object({
  model: z.string().trim().min(2).max(80),
  grade: z.enum(DEVICE_GRADES),
  observations: z.array(z.string().trim().min(1).max(200)).max(5).default([]),
});

export type DeviceGradingAiResult = z.infer<typeof deviceGradingAiResultSchema>;
