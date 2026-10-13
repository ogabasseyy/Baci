import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = resolve(
  currentDirectory,
  '../../../../supabase/migrations'
);
const rpcSql = readFileSync(
  resolve(migrationsDirectory, '20260516084622_quiz_phase1a_rpcs.sql'),
  'utf8'
);
const quizMigrationFiles = readdirSync(migrationsDirectory)
  .filter((file) => /^20\d{12}_.*quiz.*\.sql$/.test(file))
  .sort()
  .map((file) => ({
    file,
    sql: readFileSync(resolve(migrationsDirectory, file), 'utf8'),
  }));
const allQuizMigrationSql = quizMigrationFiles
  .map(({ sql }) => sql)
  .join('\n\n');

describe('quiz migration contracts', () => {
  // HISTORICAL. This pins the ORIGINAL Phase-1a migration file, which charged a
  // loyalty point. Migrations are append-only so that file still reads this way,
  // but it is NOT the live behaviour: 20260714102000_quiz_free_entry.sql made
  // entry free. The live contract is asserted in the free-entry test below.
  it('charged one customer loyalty point in the original Phase-1a migration', () => {
    const startAttemptSql = rpcSql.match(
      /CREATE OR REPLACE FUNCTION public\.start_quiz_attempt[\s\S]*?\$\$;/i
    )?.[0];

    expect(startAttemptSql).toBeDefined();
    expect(startAttemptSql).toMatch(
      /JOIN\s+public\.quiz_events\s+e\s+ON\s+e\.id\s*=\s*p_event_id\s+AND\s+e\.merchant_id\s*=\s*c\.merchant_id/i
    );
    expect(startAttemptSql).toMatch(/v_exam_pass_cost\s+integer\s*:=\s*1/i);
    expect(startAttemptSql).toMatch(/quiz_exam_pass_required/i);
    expect(startAttemptSql).toMatch(/ERRCODE\s*=\s*'QZ011'/i);
    expect(startAttemptSql).toMatch(
      /'remainingLoyaltyPoints',\s*v_remaining_loyalty_points/i
    );
  });

  it('makes quiz entry free: the latest start_quiz_attempt never charges loyalty points', () => {
    // The LIVE definition is whichever quiz migration defines start_quiz_attempt
    // last (filename order == apply order), so this keeps asserting the truth
    // even if a later migration redefines the function again.
    const latestStartAttemptSql = quizMigrationFiles
      .map(
        ({ sql }) =>
          sql.match(
            /CREATE OR REPLACE FUNCTION public\.start_quiz_attempt\s*\([\s\S]*?\$\$;/i
          )?.[0]
      )
      .filter((sql): sql is string => Boolean(sql))
      .at(-1);

    expect(latestStartAttemptSql).toBeDefined();

    // Entry is free, and no code path may deduct points.
    expect(latestStartAttemptSql).toMatch(
      /v_exam_pass_cost\s+constant\s+integer\s*:=\s*0/i
    );
    expect(latestStartAttemptSql).not.toMatch(/quiz_exam_pass_required/i);
    expect(latestStartAttemptSql).not.toMatch(/ERRCODE\s*=\s*'QZ011'/i);
    expect(latestStartAttemptSql).not.toMatch(
      /SET\s+loyalty_points\s*=\s*COALESCE\(c\.loyalty_points,\s*0\)\s*-/i
    );
    expect(latestStartAttemptSql).toMatch(
      /quiz_route_proof_valid\(p_route_proof,\s*'start_quiz_attempt_free_v1'/i
    );

    // The customer gate STAYS: a customers row is created by free signup, so it
    // gates on "registered on this store", not on having purchased anything.
    expect(latestStartAttemptSql).toMatch(/quiz_customer_not_found/i);
    expect(latestStartAttemptSql).toMatch(/c\.deleted_at\s+IS\s+NULL/i);
    expect(latestStartAttemptSql).toMatch(
      /JOIN\s+public\.quiz_events\s+e\s+ON\s+e\.id\s*=\s*p_event_id\s+AND\s+e\.merchant_id\s*=\s*c\.merchant_id/i
    );

    // The attempt cap must survive the rewrite — it is the only thing left
    // stopping a player from farming unlimited attempts now that entry is free.
    expect(latestStartAttemptSql).toMatch(/attempt_limit_reached/i);
    expect(latestStartAttemptSql).toMatch(/ERRCODE\s*=\s*'QZ030'/i);

    const lockIndex = latestStartAttemptSql?.indexOf('pg_advisory_xact_lock');
    const availabilityIndex = latestStartAttemptSql?.indexOf(
      "e.status = 'active'"
    );
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(availabilityIndex).toBeGreaterThanOrEqual(0);
    expect(lockIndex).toBeLessThan(availabilityIndex ?? -1);
    expect(latestStartAttemptSql).toMatch(/pg_catalog\.clock_timestamp\(\)/i);

    // The API checks this marker before invoking start_quiz_attempt. Because the
    // marker and free-entry function share one migration transaction, a
    // code-before-database deploy fails before it can call the stale paid RPC.
    expect(allQuizMigrationSql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.quiz_free_entry_ready\(\)[\s\S]*?SELECT true;/i
    );
    expect(allQuizMigrationSql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.quiz_free_entry_ready\(\) TO authenticated, service_role;/i
    );
  });

  // Free entry is meaningless if PURCHASES still decide who WINS. Both ranking
  // functions used to break score ties on `COALESCE(loyalty_points, 0) DESC`,
  // and loyalty points are only ever earned by buying — so a free entrant tied
  // on score always lost to a bigger spender. Ranking must be skill and speed
  // only, in BOTH functions, or the leaderboard players watch stops matching the
  // winners actually minted.
  it.each([
    [
      'mint_quiz_event_ranked_awards',
      /CREATE OR REPLACE FUNCTION public\.mint_quiz_event_ranked_awards[\s\S]*?\$\$;/i,
    ],
    [
      'quiz_ranked_candidates_v2',
      /CREATE OR REPLACE FUNCTION private\.quiz_ranked_candidates_v2\s*\([\s\S]*?\$\$;/i,
    ],
  ])('ranks %s on skill and speed only — never on loyalty points', (_name, pattern) => {
    const latestSql = quizMigrationFiles
      .map(({ sql }) => sql.match(pattern)?.[0])
      .filter((sql): sql is string => Boolean(sql))
      .at(-1);

    expect(latestSql).toBeDefined();

    // No purchase-derived term may appear in ANY ordering key.
    expect(latestSql).not.toMatch(/loyalty_points\s*,?\s*0?\)?\s*DESC/i);
    expect(latestSql).not.toMatch(/COALESCE\([a-z]+\.loyalty_points/i);

    // The deterministic skill/speed keys must still be there, so ties never
    // resolve arbitrarily (which would make winners non-reproducible).
    expect(latestSql).toMatch(/score\s+DESC/i);
    expect(latestSql).toMatch(
      /ORDER BY[\s\S]*?[a-z_]+\.submitted_at - [a-z_]+\.started_at/i
    );
    expect(latestSql).toMatch(
      /ORDER BY[\s\S]*?submitted_at - [a-z_]+\.started_at[\s\S]*?,\s*[a-z_]+\.submitted_at(?:\s+ASC)?\s*[,)]/i
    );
  });

  it('uses the award candidate set for the public leaderboard', () => {
    const leaderboardSql = quizMigrationFiles
      .map(
        ({ sql }) =>
          sql.match(
            /CREATE OR REPLACE FUNCTION private\.quiz_ranked_candidates_v2\s*\([\s\S]*?\$\$;/i
          )?.[0]
      )
      .filter((sql): sql is string => Boolean(sql))
      .at(-1);

    expect(leaderboardSql).toBeDefined();
    expect(leaderboardSql).toMatch(/SELECT DISTINCT ON \(a\.customer_id\)/i);
    expect(leaderboardSql).toMatch(/a\.status IN \('submitted', 'scored'\)/i);
    expect(leaderboardSql).toMatch(
      /quiz_attempt_signal_flags[\s\S]*?severity = 'block'/i
    );
    expect(leaderboardSql).toMatch(
      /ORDER BY\s+a\.customer_id,\s+a\.score DESC,[\s\S]*?submitted_at,[\s\S]*?a\.id/i
    );
    expect(leaderboardSql).not.toMatch(/'disqualified'/i);
  });

  it('materializes final v2 rankings once and serves published projections from indexed rows', () => {
    expect(allQuizMigrationSql).toMatch(
      /CREATE TABLE(?: IF NOT EXISTS)? public\.quiz_event_results_v2/i
    );
    expect(allQuizMigrationSql).toMatch(
      /CREATE UNIQUE INDEX[\s\S]*?quiz_event_results_v2[\s\S]*?event_id[\s\S]*?rank/i
    );
    expect(allQuizMigrationSql).toMatch(
      /CREATE UNIQUE INDEX[\s\S]*?quiz_event_results_v2[\s\S]*?event_id[\s\S]*?customer_id/i
    );

    const latestLeaderboardSql = quizMigrationFiles
      .map(
        ({ sql }) =>
          sql.match(
            /CREATE OR REPLACE FUNCTION public\.get_quiz_leaderboard_public_v2\s*\([\s\S]*?\$\$;/i
          )?.[0]
      )
      .filter((sql): sql is string => Boolean(sql))
      .at(-1);

    expect(latestLeaderboardSql).toMatch(/public\.quiz_event_results_v2/i);
    expect(latestLeaderboardSql).not.toMatch(/quiz_ranked_candidates_v2/i);
  });

  it('uses explicit server-derived milliseconds for speed ties', () => {
    const latestRankingSql = quizMigrationFiles
      .map(
        ({ sql }) =>
          sql.match(
            /CREATE OR REPLACE FUNCTION private\.quiz_ranked_candidates_v2\s*\([\s\S]*?\$\$;/i
          )?.[0]
      )
      .filter((sql): sql is string => Boolean(sql))
      .at(-1);

    expect(latestRankingSql).toMatch(/elapsed_milliseconds/i);
    expect(latestRankingSql).toMatch(/\* 1000/);
    expect(latestRankingSql).not.toMatch(/loyalty_points/i);
  });
});
