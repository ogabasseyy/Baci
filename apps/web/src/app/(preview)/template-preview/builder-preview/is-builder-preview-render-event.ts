import { MAX_AI_EDIT_BODY_BYTES } from '@baci/shared/contracts';

function decodeEventData(event: Event): unknown {
  if (!('data' in event)) return null;
  if (typeof event.data !== 'string') return event.data;
  if (event.data.length > MAX_AI_EDIT_BODY_BYTES) return null;
  if (new TextEncoder().encode(event.data).byteLength > MAX_AI_EDIT_BODY_BYTES)
    return null;
  try {
    return JSON.parse(event.data) as unknown;
  } catch {
    return null;
  }
}

export function isBuilderPreviewRenderEvent(event: Event): boolean {
  const parsed = decodeEventData(event);
  return (
    typeof parsed === 'object' &&
    parsed !== null &&
    'type' in parsed &&
    parsed.type === 'baci.builder-preview.render'
  );
}
