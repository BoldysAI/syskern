# Syskern Design System

> Référence visuelle pour agents IA. Détails composants → `frontend.md` § Identité visuelle.

## Color strategy

**Restrained** — tinted neutrals + brand accents. Primary green for CTAs; warm orange for pricing/dirty states only.

### Brand primitives

| Token | Hex | Usage |
|---|---|---|
| `brand-navy` | `#162F56` | Sidebar, headings |
| `brand-green` / `primary` | `#649E5F` | CTA, success, nav active |
| `brand-orange` / `warm` | `#F78F26` | Pricing accents, dirty rows |
| `brand-blue` | `#09B0E6` | Info, in-progress |
| `brand-pink` / `destructive` | `#C92359` | Errors, destructive |

### Semantic surfaces

| Token | Usage |
|---|---|
| `background` | Page canvas |
| `card` | Panels, table rows |
| `surface-elevated` | Filter sidebars, elevated panels |
| `surface-inset` | Dense table zones |
| `muted` | Table header, subtle fills |

### Data states

| Token | Usage |
|---|---|
| `data-positive` | Success, positive delta |
| `data-negative` | Errors, negative delta |
| `data-dirty` | Recalculation needed |

## Typography

- **UI:** Plus Jakarta Sans (`--font-sans`)
- **Data:** JetBrains Mono (`--font-mono`) — PA, PR, PV, PAMP columns
- Scale: fixed rem (product UI), `text-2xl` page titles, `text-xs` table headers

## Radius

- Cards, inputs: `rounded-lg` (10px / `--radius`)
- Badges, pills: `rounded-md`
- Modals: `rounded-xl`

## Shadows

- `--shadow-soft`, `--shadow-card`, `--shadow-elevated` (navy-tinted)

## Z-index scale

| Layer | Value | Usage |
|---|---|---|
| sticky | 10 | Table headers |
| dropdown | 20 | Menus |
| sheet | 30 | Side panels |
| dialog | 40 | Modals |
| toast | 50 | Sonner |

## Icons

- **App UI:** Phosphor via `AppIcon` (duotone nav, regular lists)
- **shadcn primitives:** Lucide (internal only)

## Motion

- 150–200ms transitions on hover/focus
- `prefers-reduced-motion`: disable translate animations
- State feedback via sonner toasts

## Components

See `docs/agent/frontend.md` § Composants métier UI.
