# docs/agent/frontend.md — Conventions frontend (Next.js + TypeScript)

> Lis ce fichier avant toute tâche frontend.
> Règles transverses → `/AGENTS.md` §7 (Context7 obligatoire).
> Référence : `frontend/src/lib/api.ts`, `frontend/src/lib/auth.ts`,
> `frontend/src/contexts/AuthContext.tsx`, `frontend/src/app/catalog/page.tsx`.

---

## ⚠️ Warning — stack post-training

**Next.js 16 / React 19 / Tailwind CSS 4 sont tous postérieurs au training des modèles IA.**
Les APIs, conventions et structures de fichiers DIFFÈRENT de ce que tu connais.
**Récupère la documentation à jour via Context7 avant d'écrire du code framework.**
Tiens compte de toutes les dépréciations.

---

## Stack exacte (voir `frontend/package.json` pour les versions)

| Lib | Rôle |
|---|---|
| Next.js 16 (App Router) | Routing, SSR/RSC, middleware |
| React 19 | UI |
| TypeScript 5 | Typage |
| Tailwind CSS 4 | Styles (config PostCSS — PAS de `tailwind.config.js`) |
| SWR 2 | Data fetching / cache client |
| Radix UI | Primitives headless (Dialog, Select, Tabs, Tooltip…) |
| Lucide React | Icônes |
| Recharts | Graphiques (PA/PR/PV) |
| `clsx` + `tailwind-merge` | `cn()` utilitaire dans `lib/utils.ts` |

---

## Appeler l'API

**Toutes les requêtes passent par `lib/api.ts`.** Jamais de `fetch()` brut dans un composant.

### Ajouter un endpoint

```typescript
// 1. Interface dans lib/api.ts (si nouveau type de réponse)
export interface MyResource {
  id: string;
  name: string;
  amount: string;   // Decimal → toujours string depuis l'API
}

// 2. Fonction dans lib/api.ts
export function getMyResource(id: string): Promise<MyResource> {
  return apiFetch<MyResource>(`/api/my-resources/${encodeURIComponent(id)}/`);
}

export function createMyResource(data: Partial<MyResource>): Promise<MyResource> {
  return apiFetch<MyResource>("/api/my-resources/", {
    method: "POST",
    body: JSON.stringify(data),
  });
}
```

**Règles :**
- Les champs `Decimal` du backend arrivent comme `string` → ne jamais les utiliser dans des calculs
  arithmétiques côté front. `parseFloat()` uniquement pour affichage.
- Les IDs sont des UUID en `string`.
- `credentials: "include"` et `X-CSRFToken` sont gérés par `apiFetch` — ne pas les répéter.

### Tâches Celery async → `dispatchAndPoll`

```typescript
// Dispatch une tâche et attend le résultat — ne pas réimplémenter le polling dans les composants.
export function myAsyncAction(id: string): Promise<MyResource> {
  return dispatchAndPoll<MyResource>(
    `/api/my-resources/${id}/my-action/`,
    { method: "POST" },
    { timeoutMs: 60_000 },
  );
}
```

---

## Ajouter une page

Structure App Router : `src/app/<route>/page.tsx`.

```typescript
"use client";                         // toutes les pages actuelles sont client components

import useSWR from "swr";
import { getMyResource, type MyResource } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

export default function MyPage() {
  const { role, isLoading: authLoading } = useAuth();

  // Cache key = tableau des params qui font varier la requête
  const { data, isLoading, error } = useSWR<MyResource>(
    ["my-resource", id],
    () => getMyResource(id),
  );

  if (isLoading || authLoading) return <Skeleton />;
  if (error) return <div className="text-red-500">Erreur de chargement.</div>;

  return <div>{data?.name}</div>;
}
```

**Règles :**
- Data fetching = **SWR**. Pas de `useEffect + useState` pour fetcher.
- Cache key SWR = tableau de tous les params qui font varier la requête.
- `"use client"` en tête si le composant utilise des hooks React ou des événements.
- Path alias : `@/` = `src/`. Toujours utiliser `@/lib/api`, `@/lib/auth`, etc.

---

## Auth et contrôle d'accès

```typescript
import { useAuth } from "@/contexts/AuthContext";
import { canEdit, isAdmin } from "@/lib/auth";

const { user, role, isLoading } = useAuth();

// Roles : "admin" | "commercial" | "viewer"
if (canEdit(role)) { /* admin ou commercial */ }
if (isAdmin(role)) { /* admin uniquement */ }
```

Ne jamais comparer `role === "admin"` inline — utiliser `canEdit(role)` / `isAdmin(role)`.

---

## Styles

```typescript
import { cn } from "@/lib/utils";     // clsx + tailwind-merge — toujours cn() pour les classes conditionnelles

<div className={cn("base-class", condition && "conditional-class", props.className)} />
```

- **Tailwind 4** : config via `postcss.config.mjs`, pas de `tailwind.config.js`. Consulte Context7
  pour la syntaxe Tailwind 4 avant d'utiliser de nouvelles utilitaires.
- Couleur brand : `#E07200` (orange Syskern) — utiliser `text-[#E07200]` / `bg-[#E07200]`.
- Composants primitifs → Radix UI. Icônes → Lucide React.
- Skeleton loading → `animate-pulse bg-slate-200 rounded` (voir pattern dans `catalog/page.tsx`).

---

## Conventions TypeScript

- Interfaces pour les shapes d'objets, `type` pour les unions/aliases.
- Exporter les interfaces depuis `lib/api.ts` ; les importer avec `import type { ... }`.
- Ne jamais utiliser `any` — préférer `unknown` et narrowing si le type est vraiment inconnu.
- Les champs nullable du backend → `field: string | null`.

---

## Interdits

- ❌ `fetch()` brut dans un composant — toujours `apiFetch` via `lib/api.ts`.
- ❌ `useEffect + setState` pour fetcher — utiliser SWR.
- ❌ Arithmetic sur les `string` Decimal (`pamp_eur`, `pa_net_eur`…) — le moteur de calcul est backend.
- ❌ Implémenter le polling manuellement — utiliser `dispatchAndPoll`.
- ❌ Comparer les rôles inline — utiliser `canEdit` / `isAdmin`.
- ❌ Supposer une API Tailwind/Next.js de mémoire — Context7 d'abord.

---

## Checklist

- [ ] Nouvel endpoint : interface + fonction dans `lib/api.ts`
- [ ] Data fetching via SWR, cache key en tableau
- [ ] Decimal API fields traités comme `string`, jamais de calcul front
- [ ] Tailwind 4 : vérifier syntaxe via Context7 si doute
- [ ] `cn()` pour toutes les classes conditionnelles
- [ ] `canEdit(role)` / `isAdmin(role)` pour les guards de permission
- [ ] `"use client"` si hooks/events, sinon Server Component si possible