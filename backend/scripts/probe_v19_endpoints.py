"""Probe v19 instance endpoints to understand its API surface."""

import httpx

URL = "https://symea-odoo-18-boldys-dev-19-31446036.dev.odoo.com"

paths = [
    ("GET", "/"),
    ("GET", "/web"),
    ("GET", "/web/database/list"),
    ("GET", "/web/database/selector"),
    ("POST", "/jsonrpc"),
    ("POST", "/xmlrpc/2/common"),
    ("POST", "/json/2/auth"),
    ("POST", "/json/2/common/version"),
    ("GET", "/json/2"),
    ("GET", "/json/2/auth"),
    ("GET", "/odoo"),
    ("GET", "/odoo/sales"),  # the URL Ghang Hui sent
]

with httpx.Client(verify=False, follow_redirects=False, timeout=15.0) as c:
    for method, path in paths:
        try:
            kwargs = {}
            if method == "POST":
                kwargs = {
                    "json": {
                        "jsonrpc": "2.0",
                        "method": "call",
                        "params": {"service": "common", "method": "version", "args": []},
                    }
                }
            r = c.request(method, URL + path, **kwargs)
            ctype = r.headers.get("content-type", "?").split(";")[0]
            loc = r.headers.get("location", "")
            print(f"  {method:4s} {path:30s} -> {r.status_code}  {ctype:25s}  {loc}")
        except Exception as e:
            print(f"  {method:4s} {path:30s} -> ERROR {type(e).__name__}: {str(e)[:80]}")
