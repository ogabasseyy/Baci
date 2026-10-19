#!/usr/bin/python3 -I
import argparse
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import signal
import stat
import sys


sys.dont_write_bytecode = True
if __name__ == '__main__' and not sys.flags.isolated:
    print('{"status":"refused","stage":"isolated-python-required"}')
    sys.exit(1)
sys.path.insert(0, str(Path(__file__).absolute().parent))

from public_installation import PublicInstaller, ROOT
from public_nginx_installation import PublicNginxInstaller
from public_http_probes import baseline, public_routes
from public_owner_diagnostic import public_owner_diagnostic
from treasury_owner_contract import DEADLINE, Refused
from treasury_owner_io import private_directory, root_ancestors


def verify_bundle():
    if os.geteuid() != 0:
        raise Refused('Root-private owner execution required')
    source = Path(__file__).absolute()
    root_ancestors(source)
    private_directory(source.parent)
    metadata = source.lstat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_mode & 0o022:
        raise Refused('Unsafe owner entry point')


@contextmanager
def locked_parent():
    root_ancestors(ROOT)
    descriptor = os.open(ROOT.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(descriptor)


def main(argv=None):
    parser = argparse.ArgumentParser(description='Pinned first-card public preparation; no public routing or financial requests')
    for name in ('archive', 'archive-sha256', 'manifest', 'manifest-sha256'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--start', action='store_true', help='Start only reviewed loopback HTTP after private TLS proof')
    parser.add_argument('--activate-nginx', action='store_true', help='Install exact staging routes only after private readiness')
    arguments = parser.parse_args(argv)
    installer, nginx, stage = None, None, 'owner-bundle'
    previous = {}

    def interrupted(_number, _frame):
        raise InterruptedError()

    try:
        verify_bundle()
        if arguments.activate_nginx and not arguments.start:
            raise Refused('Nginx activation requires private service startup')
        for number in (signal.SIGTERM, signal.SIGINT):
            previous[number] = signal.signal(number, interrupted)
        with locked_parent():
            if arguments.activate_nginx:
                stage = 'nginx-preflight'
                nginx = PublicNginxInstaller(Path(__file__).absolute().parent)
                pin = nginx.preflight()
                stage = 'http-baseline'
                baseline()
                print(json.dumps(dict(stage=stage, predecessorSha256=pin)), flush=True)
            installer = PublicInstaller(arguments.archive, arguments.archive_sha256,
                                        arguments.manifest, arguments.manifest_sha256)
            steps = [('private-installation', installer.prepare), ('private-tls-proof', installer.private_proof)]
            if arguments.start:
                steps.append(('loopback-http-start', installer.start))
            if nginx:
                steps.append(('nginx-activation', lambda: nginx.install(pin, public_routes, baselineprobe=baseline)))
            try:
                for stage, operation in steps:
                    print(json.dumps(dict(stage=stage)), flush=True)
                    operation()
            except Exception as error:
                withdrawn = None
                nginx_restored = None
                if nginx:
                    try:
                        nginx.rollback()
                        nginx_restored = True
                    except Exception:
                        nginx_restored = False
                try:
                    installer.withdraw()
                    withdrawn = True if installer.start_attempted else None
                except Exception:
                    withdrawn = False
                print(json.dumps(dict(status='refused', stage=stage, redacted=True,
                                      publicWithdrawalConfirmed=withdrawn, nginxRestored=nginx_restored,
                                      **public_owner_diagnostic(error))), flush=True)
                return 1
        print(json.dumps(dict(status='restricted-public-http-started' if arguments.start else 'restricted-public-prepared',
            privateTlsVerified=True, firstCardHttpStarted=arguments.start, publicRoutingChanged=arguments.activate_nginx,
            authenticatedCustomerVerified=False, savedCardsEnabled=False, financialActionAttempted=False,
            deadline=DEADLINE, approvedBudgetKobo=10000, preservedPrincipalKobo=10000,
            manifestSha256=arguments.manifest_sha256)), flush=True)
        return 0
    except Exception as error:
        print(json.dumps(dict(status='refused', stage=stage, redacted=True,
                              **public_owner_diagnostic(error))), flush=True)
        return 1
    finally:
        for number, handler in previous.items():
            signal.signal(number, handler)


if __name__ == '__main__':
    sys.exit(main())
