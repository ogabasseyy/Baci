from __future__ import annotations

import hashlib


ENROLLMENT_SOURCE_SHA256 = '9b5a3fbba0927c655a57f53da10fa778e19b5cbfd1840c3be4f0fe40e9f29475'
LEGACY_SOURCE_SHA256 = '3e75466c4b32187504f0997b8a42feffced57b18a117639240ca88d8e2c49f04'
LEGACY_BASELINE_SHA256 = '1c64682329544754441ee7b1e522d57d03bcafe64051b283dc47a1dd61aaea11'
LEGACY_UPDATED_SHA256 = '63474f377c15a6aa4f385a49e101470d61d8116a062bdace2a3d3267899fd42e'
RESOLVER_SHA256 = '595a290db737cbf2f39bdb6e03282072285d7182b8237f522e24ef39cf5695f0'
LEGACY_SIGNATURE = 'prefunded_card.apply_verified_legacy_inflow(text,text,text,text,text,bigint,bigint,text,text,timestamptz)'
RESOLVER_SIGNATURE = 'prefunded_card.resolve_replay_enrollment(uuid,uuid,uuid,text,text,text,jsonb)'


def render_cutover(enrollment_source: str, legacy_source: str, *, rehearsal: bool = False) -> str:
    return _render(enrollment_source, legacy_source, rehearsal=rehearsal, scratch=False)


def _render_cutover_fixture(enrollment_source: str, legacy_source: str, *, rehearsal: bool = False) -> str:
    return _render(enrollment_source, legacy_source, rehearsal=rehearsal, scratch=True)


def _render(enrollment_source: str, legacy_source: str, *, rehearsal: bool, scratch: bool) -> str:
    for source, digest in ((enrollment_source, ENROLLMENT_SOURCE_SHA256), (legacy_source, LEGACY_SOURCE_SHA256)):
        if not isinstance(source, str) or hashlib.sha256(source.encode('utf-8')).hexdigest() != digest:
            raise ValueError('Reviewed replay cutover source checksum differs')
    if type(rehearsal) is not bool:
        raise ValueError('Replay cutover rehearsal must be boolean')
    scratch_allowed = 'true' if scratch else 'false'
    preflight = f"""DO $replay_cutover_preflight$
DECLARE observed text; baseline text := '{LEGACY_BASELINE_SHA256}';
BEGIN
  observed := (SELECT system_identifier::text FROM pg_catalog.pg_control_system());
  IF current_user IS DISTINCT FROM session_user
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=session_user AND rolsuper) THEN
    RAISE EXCEPTION 'replay cutover owner scope refused' USING ERRCODE='55000';
  END IF;
  IF {scratch_allowed} THEN
    IF current_setting('baci.enrollment_owner_test',true) IS DISTINCT FROM 'on'
      OR current_database() NOT LIKE 'piggyvest_legacy_enrollment_scratch%'
      OR observed='7685292944002592802'
      OR current_setting('baci.enrollment_owner_system',true) IS DISTINCT FROM observed THEN
      RAISE EXCEPTION 'replay cutover scratch scope refused' USING ERRCODE='55000';
    END IF;
  ELSIF current_setting('baci.enrollment_owner_test',true) IS DISTINCT FROM 'off'
    OR current_database()<>'postgres' OR session_user<>'postgres' OR inet_client_addr() IS NOT NULL
    OR observed<>'7685292944002592802' OR clock_timestamp()>=to_timestamp(1790697550) THEN
    RAISE EXCEPTION 'replay cutover owner scope refused' USING ERRCODE='55000';
  END IF;
  IF EXISTS(SELECT 1 FROM (VALUES
      ('{LEGACY_SIGNATURE}', ARRAY[baseline,'{LEGACY_UPDATED_SHA256}']),
      ('{RESOLVER_SIGNATURE}', ARRAY['{RESOLVER_SHA256}'])
    ) expected(signature,digests) LEFT JOIN pg_catalog.pg_proc routine ON routine.oid=to_regprocedure(expected.signature)
    WHERE routine.oid IS NULL
      OR routine.proowner IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user)
      OR NOT routine.prosecdef OR routine.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
      OR NOT (encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(expected.signature)),'UTF8')),'hex')=ANY(expected.digests))) THEN
    RAISE EXCEPTION 'replay cutover function baseline refused' USING ERRCODE='55000';
  END IF;
END
$replay_cutover_preflight$;
"""
    snapshot = f"""
CREATE TEMP TABLE replay_cutover_before ON COMMIT DROP AS
  SELECT oid,proowner,proacl FROM pg_catalog.pg_proc WHERE oid='{LEGACY_SIGNATURE}'::regprocedure;
"""
    delta = legacy_source.removeprefix('BEGIN;\n').split('\nREVOKE ALL ON FUNCTION ', 1)[0]
    delta = delta.replace('CREATE FUNCTION ', 'CREATE OR REPLACE FUNCTION ', 1)
    postflight = f"""
DO $replay_cutover_postflight$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc routine JOIN replay_cutover_before prior ON prior.oid=routine.oid
      WHERE routine.oid='{LEGACY_SIGNATURE}'::regprocedure
        AND routine.proowner=prior.proowner AND routine.proacl IS NOT DISTINCT FROM prior.proacl
        AND encode(sha256(convert_to(pg_get_functiondef('{LEGACY_SIGNATURE}'::regprocedure),'UTF8')),'hex')='{LEGACY_UPDATED_SHA256}') THEN
    RAISE EXCEPTION 'replay cutover function postflight refused' USING ERRCODE='55000';
  END IF;
END
$replay_cutover_postflight$;
"""
    lock = 'SELECT pg_advisory_xact_lock(hashtextextended('
    rendered = enrollment_source.replace(lock, preflight + lock, 1)
    rendered = rendered.replace('DO $owner$\n', snapshot + delta + postflight + 'DO $owner$\n', 1)
    return rendered.removesuffix('COMMIT;\n') + ('ROLLBACK;\n' if rehearsal else 'COMMIT;\n')
