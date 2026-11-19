#!/usr/bin/env python3
"""Disposable loopback-only routing/TLS test; requires caddy, curl and openssl.

No production hostnames, credentials, listeners, DNS or services are changed.
This does not qualify public DNS, production TLS, OAuth or rollout.
"""
import http.server
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
import time


OUTPUT_ORIGIN = 'builder-output-origin.usebaci.com'
EXECUTION_HOST = 'baci-builder-output.ogabassey-ai.workers.dev'
ORIGIN_KEY = 's' * 43
OUTPUT_RESOURCE = '/resource/' + 'c' * 64 + '/index.html'
ORIGIN_HEADER = f'X-Baci-Execution-Origin-Key: {ORIGIN_KEY}'


def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


class Backend(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(f'{self.server.label}|{self.headers.get("Host")}|{self.headers.get("X-Forwarded-For")}'.encode())

    do_POST = do_GET

    def log_message(self, *args):
        pass


def command(*args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main():
    servers = []
    with tempfile.TemporaryDirectory(prefix='baci-ingress-') as temp:
        root = Path(temp)
        ca, ca_key, client, client_key, csr, rogue, rogue_key = [root / name for name in ('ca.pem', 'ca-key.pem', 'client.pem', 'client-key.pem', 'client.csr', 'rogue.pem', 'rogue-key.pem')]
        command('openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=Synthetic CA', '-keyout', str(ca_key), '-out', str(ca))
        command('openssl', 'req', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=Synthetic Client', '-keyout', str(client_key), '-out', str(csr))
        command('openssl', 'x509', '-req', '-days', '1', '-in', str(csr), '-CA', str(ca), '-CAkey', str(ca_key), '-CAcreateserial', '-out', str(client))
        command('openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=Untrusted Client', '-keyout', str(rogue_key), '-out', str(rogue))
        proxy_port = port()
        env = os.environ.copy()
        env.update({'HOME': temp, 'XDG_CONFIG_HOME': temp, 'XDG_DATA_HOME': temp, 'BACI_OWNER_CA_FILE': str(ca)})
        for label in ('AUTH', 'MCP', 'OWNER', 'DELIVERY'):
            server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Backend)
            server.label = label
            servers.append(server)
            threading.Thread(target=server.serve_forever, daemon=True).start()
            env[f'BACI_{label}_PORT'] = str(server.server_port)
        names = {'BACI_AUTH_HOST': 'auth.localhost', 'BACI_OWNER_HOST': 'owner.localhost'}
        for name, host in names.items():
            env[name] = f'https://{host}:{proxy_port}'
        text = Path(__file__).with_name('Caddyfile.candidate').read_text()
        text = text.replace('\tadmin off', '\tadmin off\n\tauto_https disable_redirects\n\tskip_install_trust\n\tdefault_bind 127.0.0.1')
        assert 'BACI_EXECUTION_HOST' not in text, 'An independent direct output vhost remains configured'
        output_candidate = Path(__file__).resolve().parents[3] / 'builder-execution-proxy' / 'Caddyfile.candidate'
        _, site, output_vhost = output_candidate.read_text().partition(f'{OUTPUT_ORIGIN} {{')
        assert site, 'Missing execution origin vhost'
        env['BACI_EXECUTION_ORIGIN_KEY'] = ORIGIN_KEY
        text += f'\nhttps://{OUTPUT_ORIGIN}:{proxy_port} {{\n\ttls internal' + output_vhost
        text = text.replace('{$BACI_AUTH_HOST} {', '{$BACI_AUTH_HOST} {\n  tls internal', 1)
        text = text.replace('builder-mcp.usebaci.com {', f'https://builder-mcp.usebaci.com:{proxy_port} {{\n\ttls internal', 1)
        text = text.replace('\ttls {\n\t\tclient_auth', '\ttls internal {\n\t\tclient_auth', 1)
        config = root / 'Caddyfile'
        config.write_text(text)
        log = (root / 'caddy.log').open('w+')
        process = subprocess.Popen(['caddy', 'run', '--config', str(config), '--adapter', 'caddyfile'], env=env, stdout=log, stderr=log)

        def curl(host, path, *extra):
            return subprocess.run(['curl', '--silent', '--show-error', '--insecure', '--noproxy', '*', '--resolve', f'{host}:{proxy_port}:127.0.0.1', '--max-time', '5', *extra, '-w', '\n%{http_code}', f'https://{host}:{proxy_port}{path}'], capture_output=True, text=True)

        try:
            for _ in range(100):
                if process.poll() is not None:
                    raise RuntimeError('Caddy failed to start')
                ready = curl('auth.localhost', '/auth')
                if ready.returncode == 0:
                    break
                time.sleep(.1)
            else:
                raise RuntimeError('Caddy did not become ready')
            assert ready.stdout.startswith('AUTH|builder-auth.usebaci.com|127.0.0.1\n200')
            assert curl('auth.localhost', '/internal/owner/preview').stdout.endswith('\n404')
            assert curl('builder-mcp.usebaci.com', '/builder/mcp', '-H', 'X-Forwarded-For: 198.51.100.1').stdout.startswith('MCP|builder-mcp.usebaci.com|127.0.0.1\n200')
            assert curl('builder-mcp.usebaci.com', '/internal/owner/preview').stdout.endswith('\n404')
            assert curl('auth.localhost', OUTPUT_RESOURCE).stdout.endswith('\n404')
            assert curl('builder-mcp.usebaci.com', OUTPUT_RESOURCE).stdout.endswith('\n404')
            assert curl(OUTPUT_ORIGIN, OUTPUT_RESOURCE).stdout.endswith('\n404')
            accepted = curl(OUTPUT_ORIGIN, OUTPUT_RESOURCE, '-H', ORIGIN_HEADER)
            assert accepted.stdout.startswith(f'DELIVERY|{EXECUTION_HOST}|127.0.0.1\n200')
            assert curl(OUTPUT_ORIGIN, OUTPUT_RESOURCE, '-H', ORIGIN_HEADER, '-X', 'POST').stdout.endswith('\n404')
            assert curl('owner.localhost', '/internal/owner/preview').returncode != 0
            assert curl('owner.localhost', '/internal/owner/preview', '--cert', str(rogue), '--key', str(rogue_key)).returncode != 0
            confused = curl('auth.localhost', '/internal/owner/preview', '-H', 'Host: owner.localhost')
            assert not confused.stdout.startswith('OWNER|'), 'Owner route bypassed client-certificate authentication'
            owner = curl('owner.localhost', '/internal/owner/preview', '--cert', str(client), '--key', str(client_key))
            assert owner.stdout.startswith('OWNER|owner.baci-internal.invalid|127.0.0.1\n200'), owner.stderr
            assert curl('owner.localhost', '/builder/mcp', '--cert', str(client), '--key', str(client_key)).stdout.endswith('\n404')
            for server in (servers[0], servers[3]):
                server.shutdown()
                server.server_close()
            callback = '/upstream/callback?code=synthetic-code-sensitive&state=synthetic-state-sensitive'
            referer = 'synthetic-reference-sensitive'
            assert curl('auth.localhost', callback, '-H', f'Referer: https://usebaci.com/?value={referer}').stdout.endswith('\n502')
            assert curl(OUTPUT_ORIGIN, OUTPUT_RESOURCE, '-H', ORIGIN_HEADER).stdout.endswith('\n502')
            log.seek(0)
            runtime = [json.loads(line) for line in log if line.startswith('{')]
            failures = [record for record in runtime if record.get('logger') == 'http.log.error']
            assert len(failures) >= 2, 'Expected dead-upstream runtime error logging'
            assert all('headers' not in event['request'] and 'uri' not in event['request']
                       for event in failures)
            logs = json.dumps(runtime)
            assert all(marker not in logs for marker in (callback, referer, OUTPUT_RESOURCE, ORIGIN_KEY, 'synthetic-code-sensitive', 'synthetic-state-sensitive'))
            print('Synthetic HTTPS routing, owner mTLS and runtime log checks passed.')
        finally:
            process.terminate()
            process.wait(timeout=10)
            log.close()
            for server in servers:
                server.shutdown()
                server.server_close()


if __name__ == '__main__':
    main()
