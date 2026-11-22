import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const expected = process.env.GIFT_CARD_PETROCK_CALLBACK_TOKEN;
  const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
  if (
    !tokenSchema.safeParse(expected).success ||
    !tokenSchema.safeParse(token).success
  ) {
    return new Response(null, { status: 404 });
  }
  const digest = (value: string) => createHash('sha256').update(value).digest();
  if (!expected || !timingSafeEqual(digest(expected), digest(token))) {
    return new Response(null, { status: 404 });
  }

  // Discard callback bodies. Only authenticated polling can capture fulfillment.
  return new Response(null, { status: 204 });
}
