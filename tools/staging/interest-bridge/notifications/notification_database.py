import json

from notification_contract import OLD, TARGET, ROLE, ROUTINES, routine_acl


DOCKER = ['/usr/bin/docker', '--host=unix:///var/run/docker.sock']
DATABASE = [*DOCKER, 'exec', '-i', '--user', 'postgres', 'baci-isolated-savings-db-1',
            '/nix/var/nix/profiles/default/bin/psql', '-XqAt', '-U', 'postgres', '-d', 'postgres',
            '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate']


def expected_routines():
    return [dict(signature=signature, bodyMd5=values[0], language=values[1], owner='postgres',
                 securityDefiner=True, config=['search_path=""'], acl=routine_acl(signature))
            for signature, values in sorted(ROUTINES.items())]


def expected_state(expiry):
    return dict(systemIdentifier='7685292944002592802', database='postgres', sessionUser='postgres',
                localSocket=True, role=dict(exists=True, canLogin=True, inherit=False, superuser=False,
                bypassRls=False, createDb=False, createRole=False, replication=False, configIsNull=True,
                memberCount=0, validUntil=expiry), goalMatches=1, principalKobo=10000, goalAmount=100,
                otherEligibleGoals=0, otherEvents=0, orphanDeliveries=0, unscopedActiveTokens=0)


def readonly_sql(query, guard):
    return "BEGIN READ ONLY; SET LOCAL statement_timeout='20s'; SET LOCAL search_path=pg_catalog;\n" + guard + query + '\nROLLBACK;'


def renewal_sql(template, query, guard, commit=False, restore=False):
    old, new = (TARGET, OLD) if restore else (OLD, TARGET)
    window = '' if restore else """DO $$ BEGIN
      IF clock_timestamp() NOT BETWEEN '2026-09-29T15:59:10Z'::timestamptz
        AND '2026-10-06T15:56:10Z'::timestamptz THEN
        RAISE EXCEPTION 'notification renewal window refused' USING ERRCODE='42501';
      END IF;
    END $$;"""
    replacements = {
        '__TIME_GUARD__': window, '__ROLE_GUARD__': guard, '__STATE_QUERY__': query,
        '__EXPECTED_STATE__': json.dumps(expected_state(old), separators=(',', ':')),
        '__EXPECTED_ROUTINES__': json.dumps(expected_routines(), separators=(',', ':')),
        '__NEXT_EXPIRY__': new, '__FINISH__': 'COMMIT;' if commit else 'ROLLBACK;',
    }
    for marker, value in replacements.items():
        template = template.replace(marker, value)
    return template


def inspect_database(run, query, guard):
    return json.loads(run(DATABASE, readonly_sql(query, guard)).strip())


def change_expiry(run, template, query, guard, commit=False, restore=False):
    run(DATABASE, renewal_sql(template, query, guard, commit, restore))
