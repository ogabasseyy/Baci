import {
  type OxygenChatResponse,
  oxygenChatResponseSchema,
} from '@/schemas/oxygen-chat';

/** Origin comes from the trusted transport config, never a message or Host header. */
function handoffUrl(origin: string, path: string): string {
  const base = new URL(origin);
  if (
    base.protocol !== 'https:' ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== '/'
  )
    throw new Error('A trusted HTTPS application origin is required');
  return new URL(path, base.origin).toString();
}

/** WhatsApp adapter output only; dispatch and authenticated account linking are separate. */
export function formatOxygenWhatsAppReply(
  input: OxygenChatResponse,
  applicationOrigin: string
): { text: string } {
  const response = oxygenChatResponseSchema.parse(input);
  return {
    text: [
      response.prompt,
      ...response.actions.map(
        (action) =>
          `${action.label}: ${handoffUrl(applicationOrigin, action.path)}`
      ),
    ].join('\n\n'),
  };
}

/** Renderer-neutral webchat descriptor: no HTML, raw provider links or customer data. */
export function formatOxygenWebchatReply(
  input: OxygenChatResponse,
  applicationOrigin: string
) {
  const response = oxygenChatResponseSchema.parse(input);
  return {
    type: 'oxygen_application' as const,
    text: response.prompt,
    actions: response.actions.map((action) => ({
      label: action.label,
      href: handoffUrl(applicationOrigin, action.path),
    })),
  };
}
