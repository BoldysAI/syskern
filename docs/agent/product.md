# Syskern Pricing Platform

## Register

**product** — B2B internal pricing tool (not marketing).

## What it is

Internal PIM + pricing platform for Syskern (cable industry). Replaces Excel-based pricing workflows. Users: commercial buyers, pricing analysts, admins.

## Core domains

1. **PIM** — product catalog, attributes, SKU management
2. **Pricing engine** — PA → PR → PV simulations with transport chains
3. **Offers** — tariff and project offer generation (Gamma API)

## Personas

| Persona | Role | Primary screens |
|---|---|---|
| Commercial | `commercial` | Catalog, simulations, offers |
| Viewer | `viewer` | Read-only catalog and simulations |
| Admin | `admin` | Settings, users, attributes, migration |

## Design goals (redesign 2026)

- Premium product UI (Linear / Stripe Dashboard density)
- Demo-ready without marketing aesthetics
- Light mode only (MVP1)
- Unikkern brand palette, Plus Jakarta Sans UI font

## Non-goals

- Public marketing site
- Dark mode (tokens prepared, not shipped)
- Price calculation in frontend
