#!/usr/bin/env python3
"""Qualify the direct MCP vhost using disposable HTTPS and a synthetic backend."""
import http.server
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
import time

HOST = 'builder-mcp.usebaci.com'
MCP = '/builder/mcp'
METADATA = '/.well-known/oauth-protected-resource/builder/mcp'


class Upstream(http.server.BaseHTTPRequestHandler):
    def forward(self):
        self.send_response(200)
        self.end_headers()
        body = self.rfile.read(int(self.headers.get('Content-Length', '0')))
        receipt = '|'.join((self.command, self.path, self.headers['Host'],
                            self.headers['X-Forwarded-For'], body.decode()))
        self.wfile.write(receipt.encode())

    do_GET = do_POST = forward

    def log_message(self, *args):
        pass


def main():
    with tempfile.TemporaryDirectory(prefix='baci-mcp-routing-') as directory:
        root = Path(directory)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        with http.server.ThreadingHTTPServer(('127.0.0.1', 0), Upstream) as upstream:
            threading.Thread(target=upstream.serve_forever, daemon=True).start()
            try:
                smoke(root, port, upstream.server_port)
            finally:
                upstream.shutdown()


def smoke(root, port, upstream_port):
    production = Path(__file__).with_name('Caddyfile.candidate').read_text()
    site = f'{HOST} {{'
    start = production.index(site)
    stop = production.index('{$BACI_OWNER_HOST}', start)
    mcp_vhost = production[start:stop]
    config = root / 'Caddyfile'
    config.write_text(
        '{\n admin off\n auto_https disable_redirects\n'
        ' skip_install_trust\n default_bind 127.0.0.1\n}\n'
        + mcp_vhost.replace(site, f'https://{HOST}:{port} {{\n tls internal')
    )
    env = dict(os.environ, XDG_DATA_HOME=str(root), XDG_CONFIG_HOME=str(root),
               BACI_MCP_PORT=str(upstream_port))

    def request(path, *arguments):
        result = subprocess.run([
            'curl', '-ksS', '--noproxy', '*', '--path-as-is', '--max-time', '2',
            '--resolve', f'{HOST}:{port}:127.0.0.1', '-w', '\n%{http_code}',
            *arguments, f'https://{HOST}:{port}{path}',
        ], capture_output=True, text=True)
        return result.stdout

    with (root / 'caddy.log').open('w+') as log:
        process = subprocess.Popen(['caddy', 'run', '--config', str(config),
                                    '--adapter', 'caddyfile'], env=env, stdout=log, stderr=log)
        try:
            for _ in range(100):
                if process.poll() is not None:
                    log.seek(0)
                    raise RuntimeError(log.read())
                if request(METADATA).endswith('\n200'):
                    break
                time.sleep(.05)
            else:
                raise RuntimeError('Caddy did not expose resource discovery')
            assert request(METADATA) == f'GET|{METADATA}|{HOST}|127.0.0.1|\n200'
            assert 'cache-control: no-store' in request(METADATA, '-i').lower()
            assert request(MCP + '?query=synthetic', '--data', 'synthetic', '-H',
                           'X-Forwarded-For: 198.51.100.2') == (
                f'POST|{MCP}?query=synthetic|{HOST}|127.0.0.1|synthetic\n200'
            )
            for path in ('/api', '/internal/owner/preview', '/token', '/resource/synthetic',
                         MCP + '/', MCP + '/child', MCP.upper(), '/builder%2Fmcp',
                         '/other/../builder/mcp', '/.well-known/oauth-protected-resource'):
                assert request(path).endswith('\n404'), path
            assert 'GET|' not in request(MCP, '-H', 'Host: mcp.usebaci.com')
        finally:
            process.terminate()
            process.wait(timeout=10)
    print('Direct builder MCP routing smoke passed.')


if __name__ == '__main__':
    main()
