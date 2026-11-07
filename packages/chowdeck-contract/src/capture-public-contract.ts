import { writeEvidenceAtomically } from './atomic-evidence-write';
import { canonicalizeArtifact } from './canonical-artifact-digest';
import { parseCapturedDocument } from './capture-document';
import {
  assertSafeEvidenceOutput,
  type ChowdeckEvidenceClaimV1,
  type ChowdeckEvidenceManifestV1,
  computeEvidenceDigests,
} from './evidence-schema';
import {
  OFFICIAL_SOURCES,
  validatePublicDocumentSources,
} from './validate-public-document-sources';

export type { PublicDocumentSource } from './validate-public-document-sources';
export { validatePublicDocumentSources } from './validate-public-document-sources';

export const CAPTURE_LIMITS = {
  aggregateBytes: 5_242_880,
  documentBytes: 1_048_576,
  maxDepth: 32,
  parsedNodes: 20_000,
  parsedTextBytes: 524_288,
  timeoutMilliseconds: 10_000,
} as const;

export type CapturePublicContractOptions = {
  sources: unknown;
  capturedAt: string;
  captureToolDigest: string;
  outputPath?: string;
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>;
};

function mediaType(response: Response): 'application/json' | 'text/markdown' {
  const value = response.headers
    .get('content-type')
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase();
  if (value === 'application/json' || value === 'text/markdown') return value;
  throw new Error('unsupported response');
}

async function readBounded(
  response: Response,
  aggregate: { bytes: number }
): Promise<Uint8Array> {
  const declared = response.headers.get('content-length');
  if (declared !== null) {
    if (
      !/^\d+$/.test(declared) ||
      Number(declared) > CAPTURE_LIMITS.documentBytes
    ) {
      throw new Error('capture limit exceeded');
    }
  }
  if (response.body === null) throw new Error('missing response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let documentBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    documentBytes += value.byteLength;
    aggregate.bytes += value.byteLength;
    if (
      documentBytes > CAPTURE_LIMITS.documentBytes ||
      aggregate.bytes > CAPTURE_LIMITS.aggregateBytes
    ) {
      await reader.cancel();
      throw new Error('capture limit exceeded');
    }
    chunks.push(value);
  }
  const result = new Uint8Array(documentBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function unprovenClaim(
  sourceUrl: string,
  sourceKind: ChowdeckEvidenceClaimV1['sourceKind'],
  capability: ChowdeckEvidenceClaimV1['capability']
): ChowdeckEvidenceClaimV1 {
  const isList =
    capability === 'menu.category.list' || capability === 'menu.item.list';
  const hasOperation =
    capability === 'account.read' ||
    capability.startsWith('menu.category.') ||
    capability.startsWith('menu.item.');
  return {
    capability,
    status: 'unproven',
    sourceUrl,
    sourceKind,
    operation: { status: hasOperation ? 'unproven' : 'not_applicable' },
    requestFields: [],
    responseFields: [],
    authScheme: 'unproven',
    pagination: isList ? 'unproven' : 'not_applicable',
    limitations: isList
      ? ['live_behavior_unproven', 'pagination_semantics_unproven']
      : ['live_behavior_unproven'],
  };
}

export async function capturePublicContract(
  options: CapturePublicContractOptions
): Promise<ChowdeckEvidenceManifestV1> {
  try {
    const sourceManifest = validatePublicDocumentSources(options.sources);
    const aggregate = { bytes: 0 };
    const claims: ChowdeckEvidenceClaimV1[] = [];
    let parsedNodes = 0;
    let parsedTextBytes = 0;
    const fetchedSources = sourceManifest.sources.filter(
      (source) => source.fetch
    );

    for (const source of fetchedSources) {
      const capability = OFFICIAL_SOURCES.find(
        ([url]) => url === source.url
      )?.[1];
      if (capability === undefined) throw new Error('unknown source');
      const response = await options.fetchImpl(source.url, {
        headers: { 'accept-encoding': 'identity' },
        redirect: 'manual',
        signal: AbortSignal.timeout(CAPTURE_LIMITS.timeoutMilliseconds),
      });
      const encoding = response.headers.get('content-encoding');
      if (
        response.status !== 200 ||
        response.redirected ||
        (encoding !== null && encoding.toLowerCase() !== 'identity')
      ) {
        throw new Error('unsafe response');
      }
      const contentType = mediaType(response);
      const bytes = await readBounded(response, aggregate);
      const parsed = parseCapturedDocument({
        bytes,
        contentType,
        expectedCapability: capability,
        sourceUrl: source.url,
        limits: CAPTURE_LIMITS,
      });
      parsedNodes += parsed.nodes;
      parsedTextBytes += parsed.textBytes;
      claims.push(
        parsed.claim ??
          unprovenClaim(
            source.url,
            `official_${contentType === 'application/json' ? 'json' : 'markdown'}`,
            capability
          )
      );
    }

    const result = computeEvidenceDigests({
      contractVersion: 1,
      capturedAt: options.capturedAt,
      captureToolDigest: options.captureToolDigest,
      runMetrics: {
        documentsAttempted: fetchedSources.length,
        documentsCaptured: claims.length,
        parsedNodes,
        parsedTextBytes,
        transferredBytes: aggregate.bytes,
      },
      claims: claims.sort((a, b) =>
        a.sourceUrl < b.sourceUrl ? -1 : a.sourceUrl > b.sourceUrl ? 1 : 0
      ),
      limitations: ['public_documentation_shape_only'],
    });
    assertSafeEvidenceOutput(result);
    if (options.outputPath !== undefined) {
      await writeEvidenceAtomically(
        options.outputPath,
        canonicalizeArtifact(result)
      );
    }
    return result;
  } catch {
    throw new Error('Public contract capture failed');
  }
}
