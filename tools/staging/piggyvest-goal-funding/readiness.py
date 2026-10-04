import time


LEASE_EXPIRY = 1790697550
MAX_WAIT_SECONDS = 8
POLL_INTERVAL_SECONDS = 0.25
FUNDING_PATH = '/api/storefront/customer/savings/funding'
FUNDING_EXPECTATIONS = (
    ('GET', FUNDING_PATH, 401),
    ('POST', FUNDING_PATH, 401),
    ('PUT', FUNDING_PATH, 405),
)
DIRECT_FUNDING_EXPECTATIONS = FUNDING_EXPECTATIONS


class ReadinessRefused(RuntimeError):
    def __init__(self, report):
        super().__init__('Route readiness verification failed')
        self.report = report


def verify(expectations, probe, phase, wait=False, deadline_epoch=LEASE_EXPIRY):
    started = time.monotonic()
    wall_remaining = min(LEASE_EXPIRY, deadline_epoch) - time.time()
    deadline = started + min(MAX_WAIT_SECONDS, max(0, wall_remaining))
    consecutive = 0
    checks = []

    while True:
        now = time.monotonic()
        if time.time() >= LEASE_EXPIRY or time.time() >= deadline_epoch:
            raise ReadinessRefused(_report(phase, checks, deadlineReached=True))
        if now >= deadline:
            raise ReadinessRefused(_report(phase, checks, deadlineReached=True))

        checks = []
        for method, path, expected in expectations:
            remaining = deadline - time.monotonic()
            if (time.time() >= LEASE_EXPIRY or time.time() >= deadline_epoch or
                    remaining <= 0):
                raise ReadinessRefused(_report(phase, checks, deadlineReached=True))
            try:
                actual = probe(method, path, min(2, remaining))
            except Exception:
                actual = None
            if isinstance(actual, bool) or not isinstance(actual, int) or not 100 <= actual <= 599:
                actual = None
            checks.append({'method': method, 'path': path, 'expected': expected, 'actual': actual})
            if (time.time() >= LEASE_EXPIRY or time.time() >= deadline_epoch or
                    time.monotonic() >= deadline):
                raise ReadinessRefused(_report(phase, checks, deadlineReached=True))
            if expected == 401 and actual == 200:
                raise ReadinessRefused(_report(phase, checks, deadlineReached=False))

        if all(check['actual'] == check['expected'] for check in checks):
            if not wait:
                return
            consecutive += 1
            if consecutive == 2:
                return
        else:
            consecutive = 0
        if not wait:
            raise ReadinessRefused(_report(phase, checks, deadlineReached=False))
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise ReadinessRefused(_report(phase, checks, deadlineReached=True))
        time.sleep(min(POLL_INTERVAL_SECONDS, remaining))


def _report(phase, checks, deadlineReached):
    return {
        'phase': phase,
        'checks': [
            {'method': check['method'], 'path': check['path'],
             'expected': check['expected'], 'actual': check['actual']}
            for check in checks
        ],
        'deadlineReached': deadlineReached,
    }
