# Certificate-only staging HTTPS installation

This owner-run installer adds only the new
`/etc/nginx/sites-available/staging-auth.ogabassey.com` file and matching enabled
symlink. It refuses either preexisting path, requires root-owned non-writable
site directories, validates the certificate hostname and at least one day of
remaining validity, and checks existing Nginx configuration before writing.

The new virtual host uses the issued certificate and returns a fixed, uncached
503 for every matching application request. It contains no proxy, database,
filesystem-serving or authentication route. Wrong Host/SNI connections are
rejected. Access/error payload logging is disabled. Other hostnames, DNS,
firewalls, Docker, secrets and existing site files are not changed.

The installer validates the combined configuration before a graceful Nginx
reload. Failure before successful reload removes only its newly created files;
it never stops or restarts Nginx. Certificate renewal and persistent private
gateway supervision remain separate prerequisites. This is not the full public
ingress generator and must not be described as an operational savings API.

Before running, compare the uploaded script SHA256 with the reviewed local file.
Invoke using `sudo bash ./install-staging-tls.sh --install` from the isolated
staging directory. The parent must verify the public TLS chain and expected 503
afterward, and confirm existing sites remain reachable.

Validation on 15 September 2026: three synthetic/static tests pass, shell syntax
passes, and the emitted configuration passes the actual VPS Nginx parser in an
unprivileged temporary directory with a generated test-only certificate. The
parser rehearsal does not install the site or exercise privileged rollback.
Root repository lint and typecheck pass.
