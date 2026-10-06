"""Compose authenticated, unchanged SELECT sources into one physical RO snapshot."""

import hashlib
import json


def require(value):
    if not value:
        raise ValueError('notification_collection_refused')


def compose(snapshot, scope, guard):
    require(all(type(raw) is bytes for raw in (snapshot, scope, guard)))
    require(hashlib.sha256(scope).hexdigest() ==
        '1c7a8d44fb84f37d2357509abeefbc5d8465bdd1d7094c25beaa81ad8e3c30a7'
        and hashlib.sha256(guard).hexdigest() ==
        '9384fd9054ac08fc88b799ab7dfd666ca77dd049e12d9c7757d405bbf63d3e63')
    start = b'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n'
    require(snapshot.startswith(start) and snapshot.endswith(b'ROLLBACK;\n')
        and scope.startswith(start) and scope.endswith(b'ROLLBACK;\n'))
    query = snapshot[:-len(b'ROLLBACK;\n')]+guard+b'\n'+scope[len(start):]
    require(query.count(start) == 1 and query.count(b'ROLLBACK;') == 1
        and b'COMMIT;' not in query)
    return query.decode('utf-8')


def decode_output(raw):
    require(type(raw) is str and 0 < len(raw.encode()) <= 16000000)
    lines = raw.splitlines()
    require(len(lines) == 2)

    def unique(pairs):
        value = {}
        for key, item in pairs:
            require(key not in value)
            value[key] = item
        return value

    values = [json.loads(line, object_pairs_hook=unique,
        parse_constant=lambda _: require(False)) for line in lines]
    require(type(values[0]) is dict and type(values[1]) is dict
        and set(values[1]) == {'scope', 'database'})
    return dict(values[1], protectedSnapshot=values[0])
