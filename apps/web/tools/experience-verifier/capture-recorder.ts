import type { Pool } from 'pg';
import { z } from 'zod';
import { digestBytes } from '@/lib/experience/manifest-digest';
import type { RecordedPrivateCapture } from '@/lib/experience/private-capture-service';
import { validateSemanticSnapshot } from '@/lib/experience/semantic-data';
import { snapshotKeyDigest } from '@/lib/experience/snapshot-key';

const id = z.uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/);

/** Private verifier worker only: this stores evidence; it does not verify its provenance. */
export async function createVerifierCaptureRecorder(pool: Pool) {
  const check = await pool.query<{
    login: string;
    role: string;
    unsafe: boolean;
    target_unsafe: boolean;
    target_memberships: boolean;
    authenticated_member: boolean;
    verifier_member: boolean;
    extra_memberships: boolean;
  }>(`SELECT session_user AS login, current_user AS role,
    COALESCE((SELECT rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication OR rolinherit OR NOT rolcanlogin FROM pg_catalog.pg_roles WHERE rolname=session_user), true) AS unsafe,
    COALESCE((SELECT rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication OR rolinherit OR rolcanlogin FROM pg_catalog.pg_roles WHERE rolname=current_user), true) AS target_unsafe,
    EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user)) AS target_memberships,
    pg_has_role(session_user,'authenticated','MEMBER') AS authenticated_member,
    pg_has_role(session_user,'baci_experience_verifier','MEMBER') AS verifier_member,
    EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid WHERE m.member=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user) AND r.rolname<>'baci_experience_verifier') AS extra_memberships`);
  const principal = check.rows[0];
  if (
    principal?.login !== 'baci_experience_verifier_login' ||
    principal.role !== 'baci_experience_verifier' ||
    principal.unsafe !== false ||
    principal.target_unsafe !== false ||
    principal.target_memberships !== false ||
    principal.authenticated_member !== false ||
    principal.verifier_member !== true ||
    principal.extra_memberships !== false
  )
    throw Error('UNSAFE_VERIFIER_DATABASE_SESSION');
  return async (capture: RecordedPrivateCapture) => {
    id.parse(capture.id);
    id.parse(capture.merchantId);
    id.parse(capture.buildId);
    digest.parse(capture.buildDigest);
    digest.parse(capture.keyDigest);
    digest.parse(capture.evidenceDigest);
    const { key, consumesCatalog, nodes } = capture.snapshot;
    if (
      key.build !== capture.buildDigest ||
      snapshotKeyDigest(key) !== capture.keyDigest ||
      typeof consumesCatalog !== 'boolean' ||
      (consumesCatalog && key.catalog === null) ||
      !(capture.bytes instanceof Uint8Array) ||
      capture.bytes.byteLength < 1 ||
      capture.bytes.byteLength > 2097152 ||
      digestBytes(capture.bytes) !== capture.evidenceDigest
    )
      throw Error('INVALID_CAPTURE');
    const safe = validateSemanticSnapshot({
      revision: capture.keyDigest,
      path: key.path,
      nodes,
    });
    await pool.query(
      'INSERT INTO public.experience_snapshots(id,merchant_id,build_id,build_digest,key_digest,snapshot_key,catalog_revision,consumes_catalog,nodes,evidence_digest,evidence_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [
        capture.id,
        capture.merchantId,
        capture.buildId,
        capture.buildDigest,
        capture.keyDigest,
        JSON.stringify(key),
        key.catalog,
        consumesCatalog,
        JSON.stringify(safe.nodes),
        capture.evidenceDigest,
        Buffer.from(capture.bytes),
      ]
    );
  };
}
