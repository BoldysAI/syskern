"""Probe a few candidate hostnames for the v19 instance."""
import httpx

for url in [
    "https://symea-odoo-18-boldys-dev-19-31446036.odoo.com",
    "https://symea-odoo-18-boldys-dev-19-31446036.dev.odoo.com",
]:
    try:
        r = httpx.post(
            f"{url}/jsonrpc",
            json={"jsonrpc": "2.0", "method": "call",
                  "params": {"service": "common", "method": "version", "args": []}},
            timeout=15.0,
        )
        ver = r.json().get("result", {}).get("server_version")
        print(f"{url}  HTTP {r.status_code}  version={ver}")
    except Exception as e:
        print(f"{url}  {type(e).__name__}: {str(e)[:140]}")
