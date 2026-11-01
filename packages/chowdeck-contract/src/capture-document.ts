import { recognizeOfficialMarkdown } from './official-document-recognizer';
import type { ChowdeckEvidenceClaimV1 } from './schemas/evidence-schema';
import { parseStrictJson } from './strict-json-parser';

export type CaptureLimits = {
  maxDepth: number;
  parsedNodes: number;
  parsedTextBytes: number;
};

export type ParsedDocument = {
  claim: ChowdeckEvidenceClaimV1 | undefined;
  nodes: number;
  textBytes: number;
};

function inspectJson(
  value: unknown,
  limits: CaptureLimits,
  options: { initialNodes?: number; countTextBytes?: boolean } = {}
): { nodes: number; textBytes: number } {
  let nodes = options.initialNodes ?? 0;
  let textBytes = 0;
  const countTextBytes = options.countTextBytes ?? true;

  function visit(entry: unknown, depth: number): void {
    if (depth > limits.maxDepth) throw new Error('capture limit exceeded');
    nodes += 1;
    if (nodes > limits.parsedNodes) throw new Error('capture limit exceeded');
    if (countTextBytes && typeof entry === 'string') {
      textBytes += Buffer.byteLength(entry);
    }
    if (Array.isArray(entry)) {
      for (const child of entry) visit(child, depth + 1);
    } else if (typeof entry === 'object' && entry !== null) {
      for (const [key, child] of Object.entries(entry)) {
        if (countTextBytes) textBytes += Buffer.byteLength(key);
        visit(child, depth + 1);
      }
    }
    if (textBytes > limits.parsedTextBytes) {
      throw new Error('capture limit exceeded');
    }
  }

  visit(value, 0);
  return { nodes, textBytes };
}

function parseMarkdownJsonFences(
  text: string,
  limits: CaptureLimits,
  initialNodes: number
): { documents: unknown[]; nodes: number } {
  const documents: unknown[] = [];
  let nodes = initialNodes;
  for (const match of text.matchAll(/```json\s*\n([\s\S]*?)\n```/gu)) {
    const serialized = match[1];
    if (serialized === undefined) continue;
    try {
      const parsed = parseStrictJson(serialized, limits.maxDepth);
      nodes = inspectJson(parsed, limits, {
        initialNodes: nodes,
        countTextBytes: false,
      }).nodes;
      documents.push(parsed);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'capture limit exceeded'
      ) {
        throw error;
      }
    }
  }
  return { documents, nodes };
}

export function parseCapturedDocument(input: {
  bytes: Uint8Array;
  contentType: 'application/json' | 'text/markdown';
  expectedCapability: ChowdeckEvidenceClaimV1['capability'];
  sourceUrl: string;
  limits: CaptureLimits;
}): ParsedDocument {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(input.bytes);
  if (input.contentType === 'text/markdown') {
    const textBytes = Buffer.byteLength(text);
    const textNodes = text.match(/\S+/gu)?.length ?? 0;
    if (
      textBytes > input.limits.parsedTextBytes ||
      textNodes > input.limits.parsedNodes
    ) {
      throw new Error('capture limit exceeded');
    }
    const fencedJson = parseMarkdownJsonFences(text, input.limits, textNodes);
    return {
      claim: recognizeOfficialMarkdown({
        text,
        openApiDocuments: fencedJson.documents,
        capability: input.expectedCapability,
        sourceUrl: input.sourceUrl,
      }),
      nodes: fencedJson.nodes,
      textBytes,
    };
  }

  const parsed = parseStrictJson(text, input.limits.maxDepth);
  const metrics = inspectJson(parsed, input.limits);
  return {
    claim: undefined,
    ...metrics,
  };
}
