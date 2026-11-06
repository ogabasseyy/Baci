#!/usr/bin/env python3
"""Run dormant DVA evidence SQL contracts in the cart disposable database."""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile
import socket

root = Path(__file__).resolve().parents[2]
base_runner = root / 'supabase/tests/run_agentic_cart_provider_dispatch_fence.py'
source = base_runner.read_text()
anchor = "20261106193000_agentic_cart_dispatch_revocation_safety.sql').read_text()\\n sql+='\\\\n'+(root/'supabase/migrations/20261106230000_agentic_cart_dispatch_admission_off.sql').read_text()\\n tests=''"
if source.count(anchor) != 1:
    raise SystemExit('dispatch migration anchor changed; refusing stale harness')
source = source.replace(
    anchor,
    "20261106193000_agentic_cart_dispatch_revocation_safety.sql').read_text()\\n sql+='\\\\n'+(root/'supabase/migrations/20261106194000_agentic_dva_provider_success_evidence.sql').read_text()\\n sql+='\\\\n'+(root/'supabase/migrations/20261106230000_agentic_cart_dispatch_admission_off.sql').read_text()\\n tests=''",
    1,
)
anchor = "agentic_cart_provider_dispatch_revocation_race.sql').read_text()"
if source.count(anchor) != 1:
    raise SystemExit('dispatch test anchor changed; refusing stale harness')
# These fragments intentionally form one psql stream so transaction, role,
# and request.jwt.claims session state survives each file boundary.
evidence_parts = (
    'agentic_dva_provider_success_evidence_setup.sql',
    'agentic_dva_provider_success_evidence_rejections.sql',
    'agentic_dva_provider_success_evidence_persistence.sql',
)
fragment_loader = "+'\\\\n'+".join(
    f"(root/'supabase/tests/{name}').read_text()" for name in evidence_parts
)
source = source.replace(anchor, anchor + "+'\\\\n'+" + fragment_loader, 1)

# An existing same-name role is unsafe regardless of membership: it may own
# objects or carry ACLs this migration must not normalize. Exercise both forms
# in isolated clusters and verify the failed transaction leaves the role intact.
pg_config = os.environ.get('PG_CONFIG') or shutil.which('pg_config')
if not pg_config:
    raise SystemExit('pg_config not found; refusing to skip existing-role regressions')
pg_bindir = Path(os.environ.get('PG_BINDIR') or subprocess.check_output([pg_config, '--bindir'], text=True).strip())
pg_bin = {name: pg_bindir / name for name in ('initdb', 'pg_ctl', 'psql')}
if any(not binary.is_file() for binary in pg_bin.values()):
    raise SystemExit(f'PostgreSQL binaries missing from {pg_bindir}; refusing to skip existing-role regressions')
for with_membership in (False, True):
    with tempfile.TemporaryDirectory(prefix='dve-', dir='/tmp') as temp_dir:
        p = Path(temp_dir)
        (p / 'sock').mkdir()
        with (p / 'init.log').open('w') as log:
            with socket.socket() as probe:
                probe.bind(('127.0.0.1', 0))
                port = probe.getsockname()[1]
            subprocess.run([str(pg_bin['initdb']), '-D', str(p / 'data'), '-U', 'postgres', '--auth=trust', '--no-locale'], check=True, stdout=log, stderr=log)
            started = subprocess.run([str(pg_bin['pg_ctl']), '-D', str(p / 'data'), '-l', str(p / 'pg.log'), '-o', f"-h '' -k {p / 'sock'} -p {port}", 'start'], stdout=log, stderr=log)
            if started.returncode:
                details = (p / 'init.log').read_text() + ((p / 'pg.log').read_text() if (p / 'pg.log').exists() else '')
                raise SystemExit('preflight PostgreSQL startup failed: ' + details)
            conn = [str(pg_bin['psql']), '-X', '-v', 'ON_ERROR_STOP=1', '-h', str(p / 'sock'), '-p', str(port), '-U', 'postgres', '-d', 'postgres']
            try:
                setup = "CREATE ROLE agentic_dva_provider_evidence_writer NOLOGIN; CREATE ROLE dva_membership_sentinel NOLOGIN; GRANT USAGE ON SCHEMA public TO agentic_dva_provider_evidence_writer; ALTER DEFAULT PRIVILEGES FOR ROLE agentic_dva_provider_evidence_writer IN SCHEMA public GRANT SELECT ON TABLES TO dva_membership_sentinel;"
                if with_membership:
                    setup += ' GRANT agentic_dva_provider_evidence_writer TO dva_membership_sentinel;'
                subprocess.run(conn + ['-c', setup], check=True, stdout=log, stderr=log)
                snapshot_sql = "SELECT (r.rolname || ':' || r.rolcanlogin || ':' || r.rolinherit || ':' || r.rolsuper || ':' || r.rolcreatedb || ':' || r.rolcreaterole || ':' || r.rolreplication || ':' || r.rolbypassrls || ':' || coalesce(array_to_string(r.rolconfig, ','), '') || ':' || has_schema_privilege(r.oid, 'public', 'USAGE') || ':' || (SELECT count(*) FROM pg_catalog.pg_default_acl d WHERE d.defaclrole=r.oid) || ':' || (SELECT count(*) FROM pg_catalog.pg_auth_members m WHERE m.roleid=r.oid OR m.member=r.oid)) FROM pg_catalog.pg_roles r WHERE r.rolname='agentic_dva_provider_evidence_writer'"
                before = subprocess.run(conn + ['-Atc', snapshot_sql], check=True, text=True, capture_output=True).stdout.strip()
                rejected = subprocess.run(conn, input=(root / 'supabase/migrations/20261106194000_agentic_dva_provider_success_evidence.sql').read_text(), text=True, capture_output=True)
                if rejected.returncode == 0 or 'agentic DVA evidence writer role already exists' not in rejected.stderr:
                    label = 'with' if with_membership else 'without'
                    raise SystemExit(f'migration accepted a pre-existing writer role {label} membership')
                after = subprocess.run(conn + ['-Atc', snapshot_sql], check=True, text=True, capture_output=True).stdout.strip()
                if before != after:
                    raise SystemExit('failed migration mutated the pre-existing writer role or its ACL state')
            finally:
                subprocess.run([str(pg_bin['pg_ctl']), '-D', str(p / 'data'), 'stop', '-m', 'fast'], check=True, stdout=subprocess.DEVNULL)
exec(compile(source, str(base_runner), 'exec'), {'__file__': str(base_runner), '__name__': '__main__'})
