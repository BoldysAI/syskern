"""Look at what the v19 host actually serves on `/`."""

import httpx

URL = "https://symea-odoo-18-boldys-dev-19-31446036.dev.odoo.com"

with httpx.Client(verify=False, follow_redirects=False, timeout=15.0) as c:
    r = c.get(URL + "/")
    print(f"Status: {r.status_code}")
    print(f"Headers: {dict(r.headers)}")
    print()
    print("─── First 600 chars of body ───")
    print(r.text[:600])
