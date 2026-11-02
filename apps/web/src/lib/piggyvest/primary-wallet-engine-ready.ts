import 'server-only';
import {
  type PiggyvestPrimaryEngineReadiness,
  type PiggyvestPrimaryEngineSurface,
  piggyvestPrimaryEngineReadySchema,
  piggyvestPrimaryEngineSurfaceSchema,
} from '@/schemas/piggyvest-primary-engine-ready';

export const PRIMARY_ENGINE_READY_STATEMENT =
  'SELECT piggyvest_primary.engine_ready($1::text) AS result';

type EngineReadyQuery = (
  statement: string,
  parameters: readonly string[]
) => Promise<{ rows: readonly unknown[] }>;

const unavailable = (): PiggyvestPrimaryEngineReadiness => ({
  ready: false,
  missing: ['engine_readiness_unavailable'],
});

/**
 * Asks the database whether the engine fences for `surface` are in place,
 * over a session the caller has already verified. Fails closed and never
 * throws: a database error (missing function, denied EXECUTE, timeout), a
 * wrong row count or a malformed verdict all read as not ready, so a caller
 * can only credit after an explicit, well-formed ready answer.
 */
export async function readPrimaryEngineReady(
  query: EngineReadyQuery,
  surface: PiggyvestPrimaryEngineSurface
): Promise<PiggyvestPrimaryEngineReadiness> {
  const parsedSurface = piggyvestPrimaryEngineSurfaceSchema.safeParse(surface);
  if (!parsedSurface.success) return unavailable();
  try {
    const result = await query(PRIMARY_ENGINE_READY_STATEMENT, [
      parsedSurface.data,
    ]);
    if (result.rows.length !== 1) return unavailable();
    const row: unknown = result.rows[0];
    const verdict = piggyvestPrimaryEngineReadySchema.safeParse(
      typeof row === 'object' && row !== null && 'result' in row
        ? row.result
        : undefined
    );
    return verdict.success ? verdict.data : unavailable();
  } catch {
    return unavailable();
  }
}
