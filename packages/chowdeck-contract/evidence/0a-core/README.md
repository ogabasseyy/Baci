# Stage 0A core contract evidence

This directory is the destination for sanitized public-contract receipts produced by:

```bash
pnpm --filter @baci/chowdeck-contract capture:public
```

The committed public-contract receipt records a reviewed capture of official public documentation. It does not contain an authenticated provider response or prove live account behavior.

Receipts contain only closed, schema-validated claim metadata. They never contain source bodies, response headers, raw-source digests, credentials, email addresses, environment values, or private infrastructure references. A `documented` status describes recognized public documentation shape only; it does not prove live behavior or grant operation authority.
