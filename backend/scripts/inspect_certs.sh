#!/bin/sh
set -e

echo '─── Cert v16 ───'
echo Q | openssl s_client -connect syskern-odoo-boldys-test-31443618.dev.odoo.com:443 -servername syskern-odoo-boldys-test-31443618.dev.odoo.com 2>/dev/null \
  | openssl x509 -noout -subject -dates -ext subjectAltName 2>&1 | head -10

echo
echo '─── Cert v19 ───'
echo Q | openssl s_client -connect symea-odoo-18-boldys-dev-19-31446036.dev.odoo.com:443 -servername symea-odoo-18-boldys-dev-19-31446036.dev.odoo.com 2>/dev/null \
  | openssl x509 -noout -subject -dates -ext subjectAltName 2>&1 | head -10
