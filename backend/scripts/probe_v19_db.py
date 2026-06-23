"""Probe the new v19 instance to find the correct DB name."""

import httpx

URL = "https://syskern-odoo-upgrade-v19-staging-32353555.dev.odoo.com"

with httpx.Client(verify=False, timeout=20, follow_redirects=True) as c:
    # Try listing databases via db service
    r = c.post(
        URL + "/jsonrpc",
        json={
            "jsonrpc": "2.0",
            "method": "call",
            "params": {"service": "db", "method": "list", "args": []},
        },
    )
    print("db.list:", r.status_code)
    body = r.json()
    if "result" in body:
        print("  Databases:", body["result"])
    elif "error" in body:
        print("  Error:", body["error"].get("data", {}).get("message", body["error"]))

    # Also try the web/database/list endpoint
    r2 = c.get(URL + "/web/database/list")
    print("\n/web/database/list:", r2.status_code, r2.text[:300])

    # Try common.version to confirm the instance is alive
    r3 = c.post(
        URL + "/jsonrpc",
        json={
            "jsonrpc": "2.0",
            "method": "call",
            "params": {"service": "common", "method": "version", "args": []},
        },
    )
    print("\ncommon.version:", r3.status_code)
    v = r3.json().get("result", {})
    print("  version:", v.get("server_version"), "serie:", v.get("server_serie"))
