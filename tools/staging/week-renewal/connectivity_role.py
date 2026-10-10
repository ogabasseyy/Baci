from pathlib import Path


FRAGMENT = Path(__file__).with_name('connectivity-role.sql').read_text()


def render_connectivity_role_script(commit: bool) -> str:
    if type(commit) is not bool:
        raise TypeError('commit must be a boolean')
    ending = 'COMMIT;' if commit else 'ROLLBACK;'
    return f"BEGIN;\nSET LOCAL statement_timeout = '10s';\nSET LOCAL lock_timeout = '3s';\nSET LOCAL search_path = pg_catalog;\n{FRAGMENT.rstrip()}\n{ending}\n"
