import {
  type BuilderNativePreviewResponse,
  builderNativePreviewResponseSchema,
} from '@baci/shared/contracts';

export function parseNativePreviewResponse(
  raw: string
): BuilderNativePreviewResponse | null {
  if (raw.length > 4096 || new TextEncoder().encode(raw).byteLength > 4096)
    return null;
  try {
    const result = builderNativePreviewResponseSchema.safeParse(
      JSON.parse(raw) as unknown
    );
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
