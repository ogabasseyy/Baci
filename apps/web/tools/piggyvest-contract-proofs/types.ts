import type { RunMode } from './constants';

export type ProofId = 'p1' | 'p2' | 'p3' | 'p4' | 'p5' | 'p6' | 'p7';
export type Answer = 'yes' | 'no' | 'unknown' | 'not_applicable';
export type Scalar = string | number | boolean | null;

export interface Finding {
  id: string;
  question: string;
  answer: Answer;
  /** Type-level detail only. Always passed through the redactor. */
  detail?: string;
}

export interface FlatShapeEntry {
  path: string;
  type: string;
}

export interface ShapeRecord {
  name: string;
  httpStatus: number | null;
  fields: FlatShapeEntry[];
}

export type ProofStatus = 'observed' | 'skipped' | 'inconclusive' | 'failed';

export interface ProofResult {
  proof: ProofId;
  title: string;
  status: ProofStatus;
  reason?: string;
  findings: Finding[];
  shapes: ShapeRecord[];
  /** Type-level scalars only (counts, enums, kobo fee tariffs). */
  values: Record<string, Scalar>;
  notes: string[];
}

export interface EvidenceDocument {
  schema: string;
  date: string;
  mode: RunMode;
  sandboxHost: string;
  mockData: boolean;
  guards: string[];
  proofs: ProofResult[];
  assumptionsToConfirm: string[];
}
