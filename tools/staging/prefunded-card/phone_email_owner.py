import base64
import fcntl
import hmac
import ipaddress
import json
import os
from pathlib import Path
import pwd
import re
import stat
import tempfile
import time
import urllib.request
from urllib.parse import urlparse

from phone_email_contract import (
    ACTOR, CUSTOMER, EMAIL, GOAL, MERCHANT, ORIGIN, customer_update_sql, digest,
    fixture, profile, snapshot_sql, validate,
)
from runtime_owner_support import database, inspect, probe
from treasury_owner_contract import CONTAINER, DEADLINE_EPOCH, Refused
from treasury_owner_io import private_directory, read_file, root_ancestors, write_private


PHONE = Path('/home/bassey/.staging-phone-env')
PROFILE = Path('/home/bassey/baci-isolated-savings/hosted-public-client-profile.json')
AUDIT = Path('/var/lib/baci-staging-phone-email-20260928')
AUTH = 'baci-isolated-savings-auth-1'


def private_address(value):
    address = ipaddress.IPv4Address(value)
    if not any(address in ipaddress.IPv4Network(network) for network in ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16')):
        raise Refused('Private staging bridge address required')
    return str(address)


class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


def request_json(url, method, body=None, headers=None):
    location = urlparse(url)
    admin = (location.scheme == 'http' and location.port == 9999 and location.path == '/admin/users/' + ACTOR
             and not location.query and not location.fragment and not location.username and
             private_address(location.hostname) == location.hostname)
    permitted = (admin or
                 url == ORIGIN + '/auth/v1/token?grant_type=password' or
                 url.startswith(ORIGIN + '/rest/v1/customers?') or
                 url.startswith(ORIGIN + '/rest/v1/customer_savings_goals?'))
    if not permitted:
        raise Refused('Unexpected staging endpoint')
    request = urllib.request.Request(url, method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={'Content-Type': 'application/json', 'User-Agent': 'baci-staging-email-repair/1.0', **(headers or {})})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirects())
    with opener.open(request, timeout=15) as response:
        raw = response.read(131073)
        if len(raw) > 131072:
            raise Refused('Staging response too large')
        return json.loads(raw)


def admin_connection():
    auth = inspect(AUTH)
    db = inspect(CONTAINER)
    for data, service in ((auth, 'auth'), (db, 'db')):
        labels = data.get('Config', {}).get('Labels', {})
        if labels.get('com.docker.compose.project') != 'baci-isolated-savings' or labels.get('com.docker.compose.service') != service:
            raise Refused('Container scope refused')
    network = 'baci-isolated-savings_database'
    auth_network = auth['NetworkSettings']['Networks'][network]['NetworkID']
    if not auth_network or auth_network != db['NetworkSettings']['Networks'][network]['NetworkID']:
        raise Refused('Auth database network differs')
    address = private_address(auth['NetworkSettings']['Networks'][network]['IPAddress'])
    env = dict(item.split('=', 1) for item in auth['Config']['Env'])
    location = urlparse(env['GOTRUE_DB_DATABASE_URL'])
    if (location.hostname != 'db' or location.path != '/postgres' or location.port != 5432 or
            location.username != 'supabase_auth_admin' or env.get('GOTRUE_JWT_ISSUER') != ORIGIN + '/auth/v1' or
            env.get('GOTRUE_API_PORT') != '9999' or
            env.get('GOTRUE_JWT_ADMIN_ROLES') != 'service_role' or
            not re.fullmatch(r'[a-f0-9]{64}', env.get('GOTRUE_JWT_SECRET', ''))):
        raise Refused('Private Auth configuration refused')
    def encode(value):
        return base64.urlsafe_b64encode(json.dumps(value, separators=(',', ':')).encode()).decode().rstrip('=')
    now = int(time.time())
    unsigned = encode({'alg': 'HS256', 'typ': 'JWT'}) + '.' + encode({
        'role': 'service_role', 'aud': 'authenticated', 'iss': ORIGIN + '/auth/v1', 'iat': now, 'exp': now + 60})
    signature = hmac.digest(env['GOTRUE_JWT_SECRET'].encode(), unsigned.encode(), 'sha256')
    return 'http://' + address + ':9999', unsigned + '.' + base64.urlsafe_b64encode(signature).decode().rstrip('=')


def login(email, password, public_key):
    result = request_json(ORIGIN + '/auth/v1/token?grant_type=password', 'POST',
                         {'email': email, 'password': password}, {'apikey': public_key})
    if result.get('user', {}).get('id') != ACTOR or result['user'].get('email') != email or not result.get('access_token'):
        raise Refused('Same-password login identity differs')
    return result['access_token']


def replace_fixture(original, replacement, account):
    if original == replacement:
        return
    if read_file(PHONE, account.pw_uid, 0o600, 32768) != original:
        raise Refused('Phone fixture changed concurrently')
    private = Path(tempfile.mkdtemp(prefix='.staging-phone-email-', dir=PHONE.parent))
    private_fd = os.open(private, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    directory_metadata = os.fstat(private_fd)
    if (directory_metadata.st_uid != os.getuid() or
            stat.S_IMODE(directory_metadata.st_mode) != 0o700):
        os.close(private_fd)
        raise Refused('Staging directory substituted')
    filename = 'phone.env'
    descriptor = os.open(filename, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=private_fd)
    try:
        with os.fdopen(descriptor, 'w+b') as handle:
            os.fchown(handle.fileno(), account.pw_uid, account.pw_gid)
            handle.write(replacement)
            handle.flush()
            os.fsync(handle.fileno())
            handle.seek(0)
            metadata = os.fstat(handle.fileno())
            staged = os.stat(filename, dir_fd=private_fd, follow_symlinks=False)
            if ((metadata.st_dev, metadata.st_ino) != (staged.st_dev, staged.st_ino) or
                    metadata.st_nlink != 1 or metadata.st_uid != account.pw_uid or
                    metadata.st_mode & 0o777 != 0o600 or handle.read(32769) != replacement):
                raise Refused('Staged phone fixture changed concurrently')
            if read_file(PHONE, account.pw_uid, 0o600, 32768) != original:
                raise Refused('Phone fixture changed concurrently')
            os.replace(filename, PHONE, src_dir_fd=private_fd)
        directory = os.open(PHONE.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        try:
            os.unlink(filename, dir_fd=private_fd)
        except FileNotFoundError:
            pass
        os.close(private_fd)
        try:
            current = private.lstat()
            if (current.st_dev, current.st_ino) == (directory_metadata.st_dev, directory_metadata.st_ino):
                private.rmdir()
        except FileNotFoundError:
            pass


def run():
    stage = 'preflight'
    try:
        if os.geteuid() != 0 or time.time() >= DEADLINE_EPOCH:
            raise Refused('Owner execution before existing deadline required')
        account = pwd.getpwnam('bassey')
        original = read_file(PHONE, account.pw_uid, 0o600, 32768)
        values, replacement = fixture(original)
        public_key = profile(read_file(PROFILE, account.pw_uid, 0o600, 32768))
        root_ancestors(AUDIT)
        AUDIT.mkdir(mode=0o700, exist_ok=True)
        private_directory(AUDIT)
        lock = os.open(AUDIT / 'lock', os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            before = probe(snapshot_sql())
            validate(before)
            baseline_path = AUDIT / 'baseline.json'
            if baseline_path.exists():
                baseline = json.loads(read_file(baseline_path, 0, 0o600, 32768))
                validate(before, baseline['protected'])
                backup = read_file(AUDIT / 'phone-before.env', 0, 0o600, 32768)
                if digest(backup) != baseline['phoneSha256'] or fixture(backup)[1] != replacement:
                    raise Refused('Phone credentials changed since approved baseline')
            else:
                old_email = values['STAGING_PHONE_EMAIL']
                if old_email == EMAIL or before['authEmailSha'] != digest(old_email.encode()) or before['customerEmailSha'] != before['authEmailSha']:
                    raise Refused('Original email baseline unavailable')
                login(old_email, values['STAGING_PHONE_PASSWORD'], public_key)
                backup_path = AUDIT / 'phone-before.env'
                if backup_path.exists():
                    if read_file(backup_path, 0, 0o600, 32768) != original:
                        raise Refused('Original phone backup differs')
                else:
                    write_private(backup_path, original)
                baseline = {'protected': before['protected'], 'phoneSha256': digest(original)}
                write_private(baseline_path, json.dumps(baseline).encode())
            stage = 'private-auth-preflight'
            private_origin, token = admin_connection()
            stage = 'auth-email-update'
            if before['authEmailSha'] != digest(EMAIL.encode()):
                result = request_json(private_origin + '/admin/users/' + ACTOR, 'PUT',
                                      {'email': EMAIL, 'email_confirm': True}, {'Authorization': 'Bearer ' + token})
                if result.get('id') != ACTOR or result.get('email') != EMAIL:
                    raise Refused('Auth update result requires reconciliation')
            validate(probe(snapshot_sql()), baseline['protected'])
            stage = 'customer-email-update'
            if before['customerEmailSha'] != digest(EMAIL.encode()):
                database(customer_update_sql())
            validate(probe(snapshot_sql()), baseline['protected'], final=True)
            stage = 'phone-fixture-update'
            replace_fixture(original, replacement, account)
            stage = 'password-and-rls-verification'
            access = login(EMAIL, values['STAGING_PHONE_PASSWORD'], public_key)
            headers = {'apikey': public_key, 'Authorization': 'Bearer ' + access}
            customers = request_json(ORIGIN + '/rest/v1/customers?select=id,merchant_id,user_id,email&id=eq.' + CUSTOMER,
                                     'GET', headers=headers)
            goals = request_json(ORIGIN + '/rest/v1/customer_savings_goals?select=id,customer_id,merchant_id,current_amount&id=eq.' + GOAL,
                                 'GET', headers=headers)
            if customers != [{'id': CUSTOMER, 'merchant_id': MERCHANT, 'user_id': ACTOR, 'email': EMAIL}] or goals != [
                    {'id': GOAL, 'customer_id': CUSTOMER, 'merchant_id': MERCHANT, 'current_amount': 100}]:
                raise Refused('Authenticated customer or unchanged plan proof failed')
            validate(probe(snapshot_sql()), baseline['protected'], final=True)
            if read_file(PHONE, account.pw_uid, 0o600, 32768) != replacement:
                raise Refused('Phone fixture readback differs')
            print(json.dumps({'status': 'staging-email-updated', 'email': EMAIL, 'samePasswordVerified': True,
                              'sameUserVerified': True, 'principalKobo': 10000, 'pendingAttemptPreserved': True,
                              'paymentStarted': False, 'phoneReadyForNewPayment': False}))
            print('STAGING_PHONE_EMAIL_UPDATED')
        finally:
            os.close(lock)
    except Exception as error:
        print(json.dumps({'status': 'refused-or-incomplete', 'stage': stage,
                          'errorType': type(error).__name__, 'redacted': True,
                          'reason': str(error) if isinstance(error, Refused) else 'See safe stage and error type',
                          'changesMade': None, 'paymentStarted': False}))
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(run())
