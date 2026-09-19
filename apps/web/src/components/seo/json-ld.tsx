import type { ReactElement } from 'react';
import { safeJsonLdStringify } from '@/lib/json-ld-script-escape';
import type { JsonLdScriptData } from '@/lib/json-ld-types';

export type {
  JsonLdData,
  JsonLdGraphData,
  JsonLdScriptData,
  JsonLdStructuredData,
} from '@/lib/json-ld-types';

interface JsonLdProps {
  data: JsonLdScriptData | null | undefined;
}

/**
 * Renders a script tag with valid JSON-LD structured data.
 * Adheres to Google's rigorous Rich Result testing standards.
 */
export function JsonLd({ data }: JsonLdProps): ReactElement | null {
  if (data == null) return null;
  return (
    <script type="application/ld+json">{safeJsonLdStringify(data)}</script>
  );
}
