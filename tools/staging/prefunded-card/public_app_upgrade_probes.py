import hashlib
import http.client
import re
import time

from public_http_probes import asset_paths
from treasury_owner_contract import DEADLINE_EPOCH, Refused


MOUNTED_APP_SCRIPT = """const crypto=require('crypto'),fs=require('fs'),path=require('path');
const root='/app',lines=[];function walk(directory){for(const name of fs.readdirSync(directory).sort()){
const target=path.join(directory,name),info=fs.lstatSync(target);if(info.isDirectory())walk(target);
else if(info.isFile())lines.push(path.relative(root,target)+'\\0'+crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex'));
else throw new Error('non-regular app entry');}}walk(root);
lines.sort((left,right)=>Buffer.compare(Buffer.from(left),Buffer.from(right)));
process.stdout.write(crypto.createHash('sha256').update(lines.join('\\n')+'\\n').digest('hex'));"""


def mounted_app_digest(files):
    lines = [name.encode() + b'\0' + hashlib.sha256(content).hexdigest().encode() + b'\n'
             for name, content in sorted(files.items())]
    return hashlib.sha256(b''.join(lines)).hexdigest()


def prove_mounted_app(contract, files, command):
    observed = command([*contract.DOCKER, 'exec', contract.NAME, '/usr/local/bin/node',
                        '-e', MOUNTED_APP_SCRIPT]).strip()
    if not re.fullmatch('[a-f0-9]{64}', observed) or observed != mounted_app_digest(files):
        raise Refused('Public mounted app bytes differ')


def wait_for_loopback(contract, clock=time.time, sleep=time.sleep):
    deadline = min(DEADLINE_EPOCH, clock() + 15)
    while clock() < deadline:
        connection = http.client.HTTPConnection('127.0.0.1', 4800, timeout=2)
        try:
            connection.request('GET', '/api/csrf', headers=dict(contract.PROBE_HEADERS))
            response = connection.getresponse()
            if response.status == 200 and len(response.read(4097)) <= 4096:
                return
        except (OSError, http.client.HTTPException):
            pass
        finally:
            connection.close()
        remaining = deadline - clock()
        if remaining <= 0:
            break
        sleep(min(0.25, remaining))
    raise Refused('Public loopback readiness deadline exceeded')


def prove_running(contract, files, verify_container, command, probe,
                  wait_ready=None, prove_mount=None):
    wait_ready = wait_for_loopback if wait_ready is None else wait_ready
    prove_mount = prove_mounted_app if prove_mount is None else prove_mount
    try:
        verify_container(True)
    except Refused:
        verify_container(None)
        command(['/usr/bin/systemctl', 'start', contract.NAME + '.service'])
    wait_ready(contract)
    verify_container(True)
    prove_mount(contract, files, command)
    probe()


def probe_loopback(contract, limit):
    callback = None
    for method, path, expected in contract.probe_contract():
        connection = http.client.HTTPConnection('127.0.0.1', 4800, timeout=5)
        try:
            headers = dict(contract.PROBE_HEADERS)
            body = b'{}' if method in ('POST', 'PATCH', 'PUT') else None
            connection.request(method, path, body=body, headers=headers)
            response = connection.getresponse()
            content = response.read(limit + 1)
            kind = response.getheader('Content-Type', '').split(';', 1)[0]
            if response.status != expected or len(content) > limit:
                raise Refused('Public loopback probe differs')
            if method == 'GET' and path == '/savings/card-return' and kind == 'text/html':
                callback = content
        finally:
            connection.close()
    for path in asset_paths(callback):
        connection = http.client.HTTPConnection('127.0.0.1', 4800, timeout=5)
        try:
            connection.request('GET', path, headers=dict(contract.PROBE_HEADERS))
            response = connection.getresponse()
            if response.status != 200 or len(response.read(limit + 1)) > limit:
                raise Refused('Public callback asset probe differs')
        finally:
            connection.close()
