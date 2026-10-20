/** Keep the typed cart reply usable by clients that retain text blocks only.
 * This is authorized cart capability delivery to the calling assistant, not
 * shopper-facing copy. audience is advisory, NOT an access-control/redaction
 * boundary: the authorized host already receives this in structuredContent.
 * The host must handle both channels as sensitive. Verify actual ChatGPT
 * rendering during isolated live QA before claiming shopper non-disclosure.
 * Never put the capability in logs, widget metadata or a public URL.
 */
export function withGuestCartTranscript<
  T extends {
    content: { type: 'text'; text: string }[];
    structuredContent: Record<string, unknown>;
  },
>(result: T) {
  return {
    ...result,
    content: [
      ...result.content,
      {
        type: 'text' as const,
        text: JSON.stringify(result.structuredContent),
        annotations: { audience: ['assistant' as const], priority: 1 },
      },
    ],
  };
}
