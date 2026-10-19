"""Reuse the exact reviewed collectors without starting another transaction."""

import hashlib


PINS = {
    'application': '9dc1563e1255bc8a769856a2d4b86ea5358d0e1210a64af9eb3d9e035f331ca4',
    'snapshot': '46fac83a0f1bb499b9d6fd17ebb8714cd72af148f1d5dfa56285eb61584cd7ed',
}


def inspection_sql(raw, kind):
    try:
        if type(raw) is not bytes or kind not in PINS or hashlib.sha256(raw).hexdigest() != PINS[kind]:
            raise ValueError('existing_projection_inspection_refused')
        source = raw.decode('utf-8')
        if kind == 'application':
            start, end = 'WITH context AS (', 'ROLLBACK;'
            previous = 'AND identity.local_unix AND identity.read_only;'
            replacement = 'AND identity.local_unix AND NOT identity.read_only;'
            if source.count(previous) != 1:
                raise ValueError('existing_projection_inspection_refused')
            source = source.replace(previous, replacement, 1)
        else:
            start, end = 'WITH full_snapshot AS MATERIALIZED (', 'DO $financial_deadline$ BEGIN'
        if source.count(start) != 1 or source.count(end) != 1:
            raise ValueError('existing_projection_inspection_refused')
        query = source[source.index(start):source.index(end)].strip()
        if not query.endswith(';'):
            raise ValueError('existing_projection_inspection_refused')
        return "SELECT jsonb_build_object('kind','" + kind + "','value',collected.value) FROM (\n" \
            + query[:-1] + '\n) AS collected(value);\n'
    except Exception:
        raise ValueError('existing_projection_inspection_refused') from None
