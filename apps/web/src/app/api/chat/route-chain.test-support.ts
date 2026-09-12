import { generateText } from 'ai';
import type { GenerateTextWithChainOptions } from '@/ai/generate-text-with-chain';

/** Single-attempt route double; retain the real per-attempt tool boundary. */
export async function generateRouteChainAttempt(
  options: GenerateTextWithChainOptions
) {
  const provider = options.chain?.[0];
  const providerName = provider?.name ?? 'google:gemini-2.5-flash';
  options.onProviderAttempt?.(providerName);
  const result = await generateText({
    model: provider?.model ?? 'mock-model',
    system: options.system,
    messages: options.messages ?? [],
    abortSignal: options.abortSignal,
    tools: options.createToolsForAttempt?.(providerName) ?? options.tools,
  });
  return { providerName, text: result.text };
}
