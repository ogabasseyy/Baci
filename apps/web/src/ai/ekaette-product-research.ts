import 'server-only';

import { z } from 'zod';
import type { ChatProductResult } from '@/ai/chat-product-result';
import type {
  ChatAutoReply,
  ekaetteSpecTopics,
} from '@/schemas/chat-auto-reply';

const MANUFACTURERS = new Map([
  ['apple', 'apple.com'],
  ['samsung', 'samsung.com'],
  ['google', 'google.com'],
  ['xiaomi', 'mi.com'],
  ['lenovo', 'lenovo.com'],
  ['hp', 'hp.com'],
  ['dell', 'dell.com'],
]);

const MODEL_QUALIFIER =
  /^(?: pro| max| plus| ultra| mini| se| lite| fe| air)\b/;
const responseSchema = z.object({
  status: z.literal('completed'),
  output: z.array(
    z.object({
      type: z.string(),
      status: z.string().optional(),
      content: z
        .array(
          z.object({
            type: z.string(),
            text: z.string().optional(),
            annotations: z
              .array(
                z.object({
                  type: z.string(),
                  url: z.string().optional(),
                })
              )
              .optional(),
          })
        )
        .optional(),
    })
  ),
});

function normalizedWords(text: string) {
  return ` ${text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;
}

function isNamedModel(product: ChatProductResult, words: string) {
  if (!product.slug) return false;
  const name = normalizedWords(product.slug);
  const index = words.indexOf(name);
  return (
    index >= 0 && !MODEL_QUALIFIER.test(words.slice(index + name.length - 1))
  );
}

export function findNamedEkaetteProduct(
  question: string,
  products: readonly ChatProductResult[]
) {
  const words = normalizedWords(question);
  const matches = products.filter((product) => isNamedModel(product, words));
  return matches.length === 1 ? matches[0] : undefined;
}

function sourceUrl(raw: string, domain: string) {
  const url = URL.parse(raw);
  if (
    url?.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    (url.hostname !== domain && !url.hostname.endsWith(`.${domain}`))
  )
    return null;
  url.search = '';
  url.hash = '';
  return url.href.length <= 240 ? url.href : null;
}

export async function researchEkaetteProduct(input: {
  model: string;
  topic: (typeof ekaetteSpecTopics)[number];
  product: ChatProductResult;
}): Promise<ChatAutoReply | null> {
  const { product, topic } = input;
  const domain = MANUFACTURERS.get(product.brand?.toLowerCase() ?? '');
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (
    !domain ||
    !apiKey ||
    !/^[\p{L}\p{N} .(),+"'&/-]{1,100}$/u.test(product.name)
  )
    return null;

  try {
    // Send only a public catalog label and a fixed topic for technical questions.
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(9_000),
      body: JSON.stringify({
        model: input.model,
        input: `Using only official manufacturer documentation, explain ${topic} for the exact product ${JSON.stringify(product.name)} in at most two short sentences. Cite the manufacturer. The listing’s condition is irrelevant to technical specifications. Answer only the technical question. Omit all shopping terms, price, availability, payment, warranty, and delivery. If the source does not confirm the exact model, say so.`,
        tools: [
          {
            type: 'web_search',
            filters: { allowed_domains: [domain] },
            search_context_size: 'low',
          },
        ],
        tool_choice: 'required',
        max_tool_calls: 1,
        max_output_tokens: 450,
        store: false,
      }),
    });
    if (!response.ok) return null;
    const parsed = responseSchema.safeParse(await response.json());
    if (
      !parsed.success ||
      !parsed.data.output.some(
        (item) => item.type === 'web_search_call' && item.status === 'completed'
      )
    )
      return null;

    const answer = parsed.data.output
      .find((item) => item.type === 'message')
      ?.content?.find((part) => part.type === 'output_text');
    const source = answer?.annotations
      ?.filter(
        (annotation) => annotation.type === 'url_citation' && annotation.url
      )
      .map((annotation) => sourceUrl(annotation.url ?? '', domain))
      .find(Boolean);
    const message = answer?.text
      ?.replace(
        /\(\[.*?\]\(https?:\/\/[^)]+\)\)|\[.*?\]\(https?:\/\/[^)]+\)|https?:\/\/\S+/gu,
        ''
      )
      .trim();
    if (!source || !message || message.length > 700) return null;

    return {
      reply: `${message}\nSource: ${source}`,
      confidence: 0.9,
      needsHuman: false,
      intent: 'details',
    };
  } catch {
    return null;
  }
}
