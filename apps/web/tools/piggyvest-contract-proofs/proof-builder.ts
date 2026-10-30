import type { ProofContext } from './proof-context';
import { flattenShape } from './shape';
import type {
  Answer,
  Finding,
  ProofId,
  ProofResult,
  ProofStatus,
  Scalar,
  ShapeRecord,
} from './types';

/**
 * Collects a proof's evidence. Free text is redacted when the result is
 * built; shapes carry no string values (shape.ts); scalars are counts,
 * enums and kobo tariffs only.
 */
export class ProofBuilder {
  private status: ProofStatus = 'observed';
  private reason: string | undefined;
  private readonly findings: Finding[] = [];
  private readonly shapes: ShapeRecord[] = [];
  private readonly values: Record<string, Scalar> = {};
  private readonly notes: string[] = [];

  constructor(
    private readonly proof: ProofId,
    private readonly title: string
  ) {}

  finding(id: string, question: string, answer: Answer, detail?: string): this {
    this.findings.push({ id, question, answer, ...(detail ? { detail } : {}) });
    return this;
  }

  shape(name: string, httpStatus: number | null, value: unknown): this {
    if (value !== undefined) {
      this.shapes.push({ name, httpStatus, fields: flattenShape(value) });
    }
    return this;
  }

  value(key: string, value: Scalar): this {
    this.values[key] = value;
    return this;
  }

  note(text: string): this {
    this.notes.push(text);
    return this;
  }

  skip(reason: string): this {
    this.status = 'skipped';
    this.reason = reason;
    return this;
  }

  inconclusive(reason: string): this {
    if (this.status === 'observed') this.status = 'inconclusive';
    this.reason ??= reason;
    return this;
  }

  fail(reason: string): this {
    this.status = 'failed';
    this.reason = reason;
    return this;
  }

  build(ctx: Pick<ProofContext, 'redactor'>): ProofResult {
    const { redactor } = ctx;
    return {
      proof: this.proof,
      title: this.title,
      status: this.status,
      ...(this.reason ? { reason: redactor.text(this.reason) } : {}),
      findings: this.findings.map((f) => ({
        ...f,
        ...(f.detail ? { detail: redactor.text(f.detail) } : {}),
      })),
      shapes: this.shapes,
      values: Object.fromEntries(
        Object.entries(this.values).map(([key, value]) => [
          key,
          typeof value === 'string' ? redactor.text(value) : value,
        ])
      ),
      notes: this.notes.map((note) => redactor.text(note)),
    };
  }
}

export function answerOf(value: boolean | null): Answer {
  return value === null ? 'unknown' : value ? 'yes' : 'no';
}
