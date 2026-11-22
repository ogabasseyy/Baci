import {
  type QuizAttemptAnswerTranscript,
  type QuizAttemptBundle,
  type QuizPackedQueueMessage,
  QuizRoomError,
} from './contracts';
import { sha256Hex, utf8ByteLength } from './crypto';

export const MAX_QUEUE_MESSAGE_BYTES = 64_000;
export const QUEUE_CHUNK_BILLING_BYTES = 64_000;

export function computeQueueOperationsForBytes(
  byteLength: number,
  retries = 0
): number {
  if (byteLength <= 0) return 0;
  const chunks = Math.max(1, Math.ceil(byteLength / QUEUE_CHUNK_BILLING_BYTES));
  return chunks * (3 + Math.max(0, retries));
}

export function canonicalBundleChecksumInput(
  bundle: Omit<
    QuizAttemptBundle,
    'partIndex' | 'totalParts' | 'bundleChecksumSha256'
  >
): string {
  return JSON.stringify({
    attemptId: bundle.attemptId,
    admissionId: bundle.admissionId,
    eventId: bundle.eventId,
    merchantId: bundle.merchantId,
    roomId: bundle.roomId,
    userId: bundle.userId,
    customerId: bundle.customerId,
    deviceHash: bundle.deviceHash,
    leaderboardUsername: bundle.leaderboardUsername,
    attemptNumber: bundle.attemptNumber,
    rulesVersion: bundle.rulesVersion,
    integrityTier: bundle.integrityTier,
    appVersion: bundle.appVersion,
    platform: bundle.platform,
    startRequestId: bundle.startRequestId,
    startedAtMs: bundle.startedAtMs,
    submittedAtMs: bundle.submittedAtMs,
    closeReason: bundle.closeReason,
    score: bundle.score,
    answers: bundle.answers,
  });
}

export function computeAttemptBundleChecksumSha256(
  bundle: Omit<
    QuizAttemptBundle,
    'partIndex' | 'totalParts' | 'bundleChecksumSha256'
  >
): Promise<string> {
  return sha256Hex(canonicalBundleChecksumInput(bundle));
}

export interface PackedMessageWithMetrics {
  message: QuizPackedQueueMessage;
  serializedJson: string;
  byteLength: number;
  queueOperations: number;
}

export interface BatchPackerStats {
  bytesPacked: number;
  queueMessages: number;
  queueOperations: number;
  bundlesPacked: number;
}

async function buildEnvelope(
  batchId: string,
  eventId: string,
  roomId: string,
  seq: number,
  createdAtMs: number,
  bundles: readonly QuizAttemptBundle[]
): Promise<PackedMessageWithMetrics> {
  const payloadSha256 = await sha256Hex(JSON.stringify(bundles));
  const message: QuizPackedQueueMessage = {
    batchId,
    eventId,
    roomId,
    seq,
    createdAtMs,
    bundleCount: bundles.length,
    bundles,
    payloadSha256,
  };
  const serializedJson = JSON.stringify(message);
  const byteLength = utf8ByteLength(serializedJson);
  return {
    message,
    serializedJson,
    byteLength,
    queueOperations: computeQueueOperationsForBytes(byteLength),
  };
}

function estimateEnvelopeBytes(
  batchId: string,
  eventId: string,
  roomId: string,
  seq: number,
  createdAtMs: number,
  bundles: readonly QuizAttemptBundle[]
): number {
  const placeholder: QuizPackedQueueMessage = {
    batchId,
    eventId,
    roomId,
    seq,
    createdAtMs,
    bundleCount: bundles.length,
    bundles,
    payloadSha256: '0'.repeat(64),
  };
  return utf8ByteLength(JSON.stringify(placeholder));
}

/**
 * Byte-serialized queue packer keeping every normal and split message strictly
 * below 64,000 UTF-8 bytes including envelope metadata.
 */
export class QuizBatchPacker {
  private readonly eventId: string;
  private readonly roomId: string;
  private readonly maxBytes: number;
  private nextSeq: number;
  private buffer: QuizAttemptBundle[] = [];
  private stats: BatchPackerStats = {
    bytesPacked: 0,
    queueMessages: 0,
    queueOperations: 0,
    bundlesPacked: 0,
  };

  constructor(options: {
    eventId: string;
    roomId: string;
    initialSeq?: number;
    maxBytes?: number;
  }) {
    this.eventId = options.eventId;
    this.roomId = options.roomId;
    this.nextSeq = options.initialSeq ?? 1;
    this.maxBytes = options.maxBytes ?? MAX_QUEUE_MESSAGE_BYTES;
  }

  getBufferedCount(): number {
    return this.buffer.length;
  }

  getNextSeq(): number {
    return this.nextSeq;
  }

  getStats(): BatchPackerStats {
    return { ...this.stats };
  }

  private allocateBatchId(seq: number): string {
    return `${this.eventId}:${this.roomId}:b${seq}`;
  }

  private async emitBatch(
    bundles: readonly QuizAttemptBundle[],
    nowMs: number
  ): Promise<PackedMessageWithMetrics> {
    const seq = this.nextSeq;
    this.nextSeq += 1;
    const batchId = this.allocateBatchId(seq);
    const packed = await buildEnvelope(
      batchId,
      this.eventId,
      this.roomId,
      seq,
      nowMs,
      bundles
    );
    if (packed.byteLength >= this.maxBytes) {
      throw new QuizRoomError(
        'QUIZ_BATCH_OVERSIZED',
        `Packed batch ${batchId} (${packed.byteLength} bytes) exceeds limit ${this.maxBytes}`,
        500
      );
    }
    this.stats.bytesPacked += packed.byteLength;
    this.stats.queueMessages += 1;
    this.stats.queueOperations += packed.queueOperations;
    this.stats.bundlesPacked += bundles.length;
    return packed;
  }

  private async splitOversizedBundle(
    bundle: QuizAttemptBundle,
    nowMs: number
  ): Promise<PackedMessageWithMetrics[]> {
    const baseChecksum =
      bundle.bundleChecksumSha256 ||
      (await computeAttemptBundleChecksumSha256(bundle));
    const answers = bundle.answers;
    if (answers.length === 0) {
      throw new QuizRoomError(
        'QUIZ_BUNDLE_UNSPLITTABLE',
        `Attempt ${bundle.attemptId} has no answers yet exceeds ${this.maxBytes} bytes`,
        413
      );
    }

    const answerSlices: QuizAttemptAnswerTranscript[][] = [];
    let currentSlice: QuizAttemptAnswerTranscript[] = [];

    for (const answer of answers) {
      const candidateSlice = [...currentSlice, answer];
      const probeBundle: QuizAttemptBundle = {
        ...bundle,
        answers: candidateSlice,
        partIndex: 0,
        totalParts: 999,
        bundleChecksumSha256: baseChecksum,
      };
      const probeBytes = estimateEnvelopeBytes(
        this.allocateBatchId(this.nextSeq + answerSlices.length),
        this.eventId,
        this.roomId,
        this.nextSeq + answerSlices.length,
        nowMs,
        [probeBundle]
      );
      if (probeBytes < this.maxBytes) {
        currentSlice = candidateSlice;
      } else {
        if (currentSlice.length === 0) {
          throw new QuizRoomError(
            'QUIZ_ANSWER_OVERSIZED',
            `Single answer in attempt ${bundle.attemptId} exceeds ${this.maxBytes} bytes`,
            413
          );
        }
        answerSlices.push(currentSlice);
        currentSlice = [answer];
      }
    }
    if (currentSlice.length > 0) {
      answerSlices.push(currentSlice);
    }

    const totalParts = answerSlices.length;
    const emitted: PackedMessageWithMetrics[] = [];
    for (let partIndex = 0; partIndex < totalParts; partIndex += 1) {
      const partAnswers = answerSlices[partIndex] ?? [];
      const partBundle: QuizAttemptBundle = {
        ...bundle,
        answers: partAnswers,
        partIndex,
        totalParts,
        bundleChecksumSha256: baseChecksum,
      };
      emitted.push(await this.emitBatch([partBundle], nowMs));
    }
    return emitted;
  }

  /**
   * Adds a bundle to the packer and returns any messages emitted immediately
   * (either because adding it would reach >= 64,000 bytes or because the bundle
   * itself required deterministic multi-part splitting).
   */
  async addBundle(
    rawBundle: QuizAttemptBundle,
    nowMs = Date.now()
  ): Promise<PackedMessageWithMetrics[]> {
    const checksum =
      rawBundle.bundleChecksumSha256 ||
      (await computeAttemptBundleChecksumSha256(rawBundle));
    const bundle: QuizAttemptBundle = {
      ...rawBundle,
      partIndex: 0,
      totalParts: 1,
      bundleChecksumSha256: checksum,
    };

    const emitted: PackedMessageWithMetrics[] = [];

    const singleBatchId = this.allocateBatchId(this.nextSeq);
    const singleBytes = estimateEnvelopeBytes(
      singleBatchId,
      this.eventId,
      this.roomId,
      this.nextSeq,
      nowMs,
      [bundle]
    );
    if (singleBytes >= this.maxBytes) {
      if (this.buffer.length > 0) {
        emitted.push(await this.emitBatch(this.buffer, nowMs));
        this.buffer = [];
      }
      const splitMessages = await this.splitOversizedBundle(bundle, nowMs);
      emitted.push(...splitMessages);
      return emitted;
    }

    const candidateBuffer = [...this.buffer, bundle];
    const nextBatchId = this.allocateBatchId(this.nextSeq);
    const candidateBytes = estimateEnvelopeBytes(
      nextBatchId,
      this.eventId,
      this.roomId,
      this.nextSeq,
      nowMs,
      candidateBuffer
    );

    if (candidateBytes >= this.maxBytes && this.buffer.length > 0) {
      emitted.push(await this.emitBatch(this.buffer, nowMs));
      this.buffer = [bundle];
    } else {
      this.buffer = candidateBuffer;
    }

    return emitted;
  }

  /**
   * Flushes whatever bundles remain in the buffer (even 1 underfilled bundle).
   */
  flush(nowMs = Date.now()): Promise<PackedMessageWithMetrics | null> {
    if (this.buffer.length === 0) return Promise.resolve(null);
    const toFlush = this.buffer;
    this.buffer = [];
    return this.emitBatch(toFlush, nowMs);
  }
}

export interface ReassembleResult {
  duplicateBatch: boolean;
  completedBundles: QuizAttemptBundle[];
  pendingSplitAttemptIds: string[];
}

/**
 * Verifies queue envelope SHA-256 payloads, deduplicates redelivered batches,
 * and reassembles split transcripts before verifying `bundleChecksumSha256`.
 */
export class QuizBatchReassembler {
  private readonly seenBatchIds = new Set<string>();
  private readonly completedAttemptIds = new Set<string>();
  private readonly pendingParts = new Map<
    string,
    {
      totalParts: number;
      checksum: string;
      parts: Map<number, QuizAttemptBundle>;
    }
  >();

  async acceptMessage(
    message: QuizPackedQueueMessage
  ): Promise<ReassembleResult> {
    const actualPayloadHash = await sha256Hex(JSON.stringify(message.bundles));
    if (actualPayloadHash !== message.payloadSha256) {
      throw new QuizRoomError(
        'QUIZ_BATCH_PAYLOAD_CORRUPT',
        `Payload SHA-256 mismatch for batch ${message.batchId}`,
        400
      );
    }

    if (this.seenBatchIds.has(message.batchId)) {
      return {
        duplicateBatch: true,
        completedBundles: [],
        pendingSplitAttemptIds: Array.from(this.pendingParts.keys()),
      };
    }
    this.seenBatchIds.add(message.batchId);

    const completedBundles: QuizAttemptBundle[] = [];

    for (const bundle of message.bundles) {
      if (this.completedAttemptIds.has(bundle.attemptId)) {
        continue;
      }

      if (bundle.totalParts <= 1) {
        const expectedChecksum =
          await computeAttemptBundleChecksumSha256(bundle);
        if (expectedChecksum !== bundle.bundleChecksumSha256) {
          throw new QuizRoomError(
            'QUIZ_BUNDLE_CHECKSUM_MISMATCH',
            `Bundle checksum mismatch for attempt ${bundle.attemptId}`,
            400
          );
        }
        this.completedAttemptIds.add(bundle.attemptId);
        completedBundles.push({
          ...bundle,
          partIndex: 0,
          totalParts: 1,
          bundleChecksumSha256: expectedChecksum,
        });
        continue;
      }

      if (
        bundle.partIndex < 0 ||
        bundle.partIndex >= bundle.totalParts ||
        !Number.isInteger(bundle.partIndex) ||
        !Number.isInteger(bundle.totalParts)
      ) {
        throw new QuizRoomError(
          'QUIZ_BUNDLE_PART_INVALID',
          `Invalid split part ${bundle.partIndex}/${bundle.totalParts} for ${bundle.attemptId}`,
          400
        );
      }

      let entry = this.pendingParts.get(bundle.attemptId);
      if (!entry) {
        entry = {
          totalParts: bundle.totalParts,
          checksum: bundle.bundleChecksumSha256,
          parts: new Map(),
        };
        this.pendingParts.set(bundle.attemptId, entry);
      } else if (
        entry.totalParts !== bundle.totalParts ||
        entry.checksum !== bundle.bundleChecksumSha256
      ) {
        throw new QuizRoomError(
          'QUIZ_BUNDLE_SPLIT_CONFLICT',
          `Conflicting split metadata for attempt ${bundle.attemptId}`,
          400
        );
      }

      if (!entry.parts.has(bundle.partIndex)) {
        entry.parts.set(bundle.partIndex, bundle);
      }

      if (entry.parts.size === entry.totalParts) {
        const mergedAnswers: QuizAttemptAnswerTranscript[] = [];
        for (let idx = 0; idx < entry.totalParts; idx += 1) {
          const part = entry.parts.get(idx);
          if (!part) {
            throw new QuizRoomError(
              'QUIZ_BUNDLE_PART_MISSING',
              `Missing part ${idx} for attempt ${bundle.attemptId}`,
              400
            );
          }
          mergedAnswers.push(...part.answers);
        }
        const firstPart = entry.parts.get(0);
        if (!firstPart) {
          throw new QuizRoomError(
            'QUIZ_BUNDLE_PART_MISSING',
            `Missing part 0 for attempt ${bundle.attemptId}`,
            400
          );
        }
        const merged: QuizAttemptBundle = {
          ...firstPart,
          answers: mergedAnswers,
          partIndex: 0,
          totalParts: 1,
          bundleChecksumSha256: entry.checksum,
        };
        const verifiedChecksum =
          await computeAttemptBundleChecksumSha256(merged);
        if (verifiedChecksum !== entry.checksum) {
          throw new QuizRoomError(
            'QUIZ_BUNDLE_CHECKSUM_MISMATCH',
            `Reassembled bundle checksum mismatch for attempt ${bundle.attemptId}`,
            400
          );
        }
        this.pendingParts.delete(bundle.attemptId);
        this.completedAttemptIds.add(bundle.attemptId);
        completedBundles.push(merged);
      }
    }

    return {
      duplicateBatch: false,
      completedBundles,
      pendingSplitAttemptIds: Array.from(this.pendingParts.keys()),
    };
  }
}
