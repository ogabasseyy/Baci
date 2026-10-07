import { applySupabaseReplaySql } from '../../apps/web/tools/db/apply-supabase-replay-sql';
import { assertHostedSavingsAuthPreserved } from './hosted-savings-install-auth';
import type { readHostedSavingsInstallBundle } from './hosted-savings-install-bundle';
import { hostedSavingsInstallDiagnostic } from './hosted-savings-install-diagnostic';
import { hostedSavingsInstallSql } from './hosted-savings-install-sql';

type Bundle = Awaited<ReturnType<typeof readHostedSavingsInstallBundle>>;
interface Runtime {
  verify(): Promise<void>;
  sql(body: string): Promise<string>;
}

export async function installHostedSavings(
  bundle: Bundle,
  runtime: Runtime,
  apply = false,
  allowedNewMemberships: readonly { role: string; member: string }[] = []
) {
  let attemptedOrdinal = 0;
  let completed = 0;
  let phase = 'container-preflight';
  let claimed = false;
  let migrationDiagnostic: ReturnType<typeof hostedSavingsInstallDiagnostic> =
    {};
  try {
    await runtime.verify();
    phase = 'database-preflight';
    await runtime.sql(
      hostedSavingsInstallSql.maintenance + hostedSavingsInstallSql.fresh
    );
    phase = 'auth-snapshot';
    const before = await runtime.sql(hostedSavingsInstallSql.snapshot);
    assertHostedSavingsAuthPreserved(before, before, allowedNewMemberships);
    if (!apply)
      return {
        status: 'preflight-passed',
        manifestSha256: bundle.manifestSha256,
        completed: 0,
        claimed: false,
      };
    phase = 'claim-fresh-ledger';
    await runtime.sql(
      hostedSavingsInstallSql.maintenance + hostedSavingsInstallSql.initialize
    );
    claimed = true;
    for (const entry of bundle.entries) {
      attemptedOrdinal = entry.ordinal;
      phase = 'maintenance';
      await runtime.verify();
      await runtime.sql(hostedSavingsInstallSql.maintenance);
      phase = 'migration';
      await applySupabaseReplaySql(
        async () => {
          try {
            return await runtime.sql(entry.sql);
          } catch (error) {
            migrationDiagnostic = hostedSavingsInstallDiagnostic(
              error instanceof Error ? error.message : ''
            );
            const location = migrationDiagnostic.line
              ? ` (line=${migrationDiagnostic.line}${migrationDiagnostic.sqlstate ? `,sqlstate=${migrationDiagnostic.sqlstate}` : ''})`
              : '';
            throw new Error(`docker failed: non-zero-exit${location}`);
          }
        },
        {
          kind: 'migration',
          ordinal: entry.ordinal,
          sqlPath: entry.file,
        }
      );
      phase = 'auth-preservation';
      assertHostedSavingsAuthPreserved(
        before,
        await runtime.sql(hostedSavingsInstallSql.snapshot),
        allowedNewMemberships
      );
      phase = 'journal';
      const match = /^supabase\/migrations\/(\d{14})_([a-z0-9_]+)\.sql$/.exec(
        entry.source
      );
      if (!match || !/^[a-f0-9]{64}$/.test(entry.sha256))
        throw new Error('Invalid journal identity');
      const delimiter = `$install_${entry.sha256}$`;
      if (entry.sql.includes(delimiter))
        throw new Error('Ledger delimiter collision');
      const bootstrap =
        entry.stage === 'bootstrap'
          ? `INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${match[1]}','${match[2]}',ARRAY[${delimiter}${entry.sql}${delimiter}]::text[]);`
          : '';
      await runtime.sql(`BEGIN; ${bootstrap}
        INSERT INTO hosted_savings_install_private.journal(ordinal,source,sha256)
        VALUES(${entry.ordinal},'${entry.source}','${entry.sha256}'); COMMIT;`);
      completed += 1;
    }
    phase = 'final-maintenance';
    await runtime.verify();
    await runtime.sql(hostedSavingsInstallSql.maintenance);
    phase = 'ledger-verification';
    const actual = await runtime.sql(
      `SELECT COALESCE(jsonb_agg(jsonb_build_object('version',version,'name',name) ORDER BY version,name),'[]')::text FROM supabase_migrations.schema_migrations;`
    );
    const expected = bundle.entries
      .filter((entry) => entry.stage === 'bootstrap')
      .map((entry) => {
        const match = /\/(\d{14})_([a-z0-9_]+)\.sql$/.exec(entry.source);
        return { version: match?.[1], name: match?.[2] };
      });
    const rows: { version: string; name: string }[] = JSON.parse(actual);
    if (
      JSON.stringify(rows.map((row) => [row.version, row.name])) !==
      JSON.stringify(expected.map((row) => [row.version, row.name]))
    )
      throw new Error('Bootstrap ledger mismatch');
    phase = 'journal-verification';
    const journal = await runtime.sql(
      "SELECT COALESCE(jsonb_agg(jsonb_build_array(ordinal,source,sha256) ORDER BY ordinal),'[]')::text FROM hosted_savings_install_private.journal;"
    );
    if (
      JSON.stringify(JSON.parse(journal)) !==
      JSON.stringify(
        bundle.entries.map((entry) => [
          entry.ordinal,
          entry.source,
          entry.sha256,
        ])
      )
    )
      throw new Error('Installer journal mismatch');
    return {
      status: 'installed',
      manifestSha256: bundle.manifestSha256,
      completed,
      claimed,
    };
  } catch (error) {
    const diagnostic =
      phase === 'migration'
        ? migrationDiagnostic
        : hostedSavingsInstallDiagnostic(
            error instanceof Error ? error.message : ''
          );
    return {
      status: 'failed',
      manifestSha256: bundle.manifestSha256,
      phase,
      attemptedOrdinal,
      completed,
      claimed,
      resumeAllowed: false,
      ...diagnostic,
      cleanup:
        'No container, volume, Auth data or partial schema deleted; keep maintenance and review before any retry.',
    };
  }
}
