# Cahier des charges technique — Pricing Platform MVP1

Créée par: Yassine Chenik
Date de création: 28 avril 2026 11:40
Type de document: Cahier des charges/Spec
Dernière modification par: Yassine Chenik
Heure de la dernière modification: 13 mai 2026 18:28
Projet: Syskern - MVP1 Pricing Platform (https://www.notion.so/Syskern-MVP1-Pricing-Platform-32574dd6427b8180ad94e4575107c817?pvs=21)

# Cahier des charges technique — Pricing Platform MVP1

> **Projet** : Syskern Pricing Platform — MVP1
> 

> **Document destiné à** : agents IA de code et développeurs Boldys
> 

> **Nature** : spécifications techniques d'implémentation (pas de contenu contractuel)
> 

> **Version** : 1.0 — 28/04/2026
> 

> **Sources** : kickoff Olivier (02/04), échanges mail Olivier (08/04), call Ghang Hui (24/04), décisions architecturales Boldys
> 

---

## Comment lire ce document

Ce cahier des charges est la **source de vérité technique** pour l'implémentation du MVP1. Il décrit ce qu'il faut construire, comment, et avec quelles règles métier. Il ne contient ni planning, ni budget, ni clauses contractuelles — ces éléments figurent dans l'annexe technique séparée.

**Convention de notation :**

- ✅ **Validé** : décision actée, à implémenter tel quel
- ⚠️ **À valider** : hypothèse à confirmer avant implémentation
- ❌ **Hors scope** : explicitement exclu du MVP1
- 📌 **Décision archi** : choix structurant à respecter

---

# 1. Vue d'ensemble

## 1.1 Objectif du produit

La plateforme remplace un processus de pricing actuellement géré sur fichiers Excel par une seule personne (Olivier). Elle a trois finalités :

1. **Centraliser la base produits** (PIM) : volume cible 3 000+ SKU, sans limite technique imposée par la plateforme. Les attributs couverts : techniques, marketing, logistiques, commerciaux.
2. **Automatiser le calcul de prix** (PA, PR, PV) en tenant compte du cours du cuivre, des taux de change, du transport, de la douane et des marges.
3. **Générer des offres commerciales** (tarifaires et projet) avec pièces jointes et argumentation IA.

La plateforme est connectée à **Odoo** qui reste le système maître pour le stock, les commandes et les clients. La plateforme devient le système maître pour l'enrichissement produit, le pricing et les offres.

## 1.2 Personas et cas d'usage

**Persona 1 — Olivier (Responsable pricing)**

- Cas principal : créer un nouveau tarif pour un client ou un groupe de clients
- Cas principal : répondre à un projet client avec une offre détaillée
- Cas secondaire : enrichir le catalogue produits (descriptions, attributs)
- Fréquence d'usage : quotidienne

**Persona 2 — Paul / Massinissa (Vendeurs)**

- Cas principal : consulter le catalogue et générer des offres simples
- Cas secondaire : créer ou compléter un produit ponctuellement
- Fréquence d'usage : régulière mais ponctuelle

**Note importante** : pas de gestion d'utilisateurs en MVP1. Un mot de passe unique partagé donne accès à tout le monde avec les mêmes droits.

## 1.3 Architecture cible (vue d'ensemble)

```jsx
┌─────────────────────────────────────────────────────────────┐
│                   FRONTEND (Next.js)                        │
│  - PIM (catalogue produits)                                 │
│  - Moteur de simulation de prix                             │
│  - Générateur d'offres                                      │
│  - Suivi des offres                                         │
└──────────────────────┬ ──────────────────────────────────────┘
                       │ HTTPS (REST/JSON)
┌──────────────────────▼──────────────────────────────────────┐
│              BACKEND (Python / Django + DRF)                │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐    │
│  │  PIM API    │  │ Pricing API  │  │  Offers API      │    │
│  └─────────────┘  └──────────────┘  └──────────────────┘    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Odoo Adapter (couche d'abstraction v16/v19)         │   │
│  └──────────────────────────────────────────────────────┘   │
└────┬──────────────┬─────────────┬──────────────┬────────────┘
     │              │             │              │
     ▼              ▼             ▼              ▼
┌─────────┐    ┌────────┐   ┌──────────┐   ┌──────────────┐
│Supabase │    │ Odoo   │   │  Gamma   │   │ DeepL/OpenAI │
│(Postgres│    │ JSON-2 │   │   API    │   │  (traduction)│
│ + Auth) │    │  API   │   │          │   │              │
└─────────┘    └────────┘   └──────────┘   └──────────────┘
```

**Hébergement** : VPS OVH (à provisionner par Boldys).

---

# 2. Stack technique

## 2.1 Stack imposé

| Couche | Technologie | Version | Justification |
| --- | --- | --- | --- |
| Frontend | **Next.js** | 14+ (App Router) | Stack standard Boldys, SSR pour perfs, écosystème React |
| Backend | **Django 5 + DRF** | 5.0–5.1 | ORM natif, DRF pour l'API REST, drf-spectacular pour OpenAPI auto, écosystème mature |
| Base de données | **Supabase (Postgres)** | 15+ | Postgres managé, Auth intégrée, Storage, RLS si besoin |
| Hébergement frontend + backend | **VPS OVH** | — | Choix client, à provisionner |
| Authentification | **Supabase Auth** (JWT vérifié via PyJWT côté Django) | — | MVP1 = mot de passe unique partagé, voir §9 |

## 2.2 Bibliothèques et services tiers

**Backend Python**

- `Django` 5.0–5.1 + `djangorestframework` 3.15 (API REST)
- `drf-spectacular` (OpenAPI auto, accessible sur `/api/docs/`)
- `django-filter` + `django-cors-headers` + `django-environ`
- `psycopg[binary]` 3.x (driver PostgreSQL)
- `PyJWT[crypto]` 2.8+ (vérification JWT Supabase Auth)
- `celery[redis]` 5.4 + `django-celery-beat` (tâches async et cron)
- `gunicorn` 22+ (serveur de production WSGI)
- `whitenoise` 6.6+ (fichiers statiques)
- `httpx` (client HTTP async pour Odoo, Gamma, DeepL)
- `pandas` + `openpyxl` (génération Excel)
- `babel` (formats devises, dates, nombres)

**Frontend Next.js**

- `next` 14+ avec App Router
- `react-hook-form` + `zod` (formulaires)
- `@tanstack/react-query` (data fetching, cache)
- `tailwindcss` (styling)
- `shadcn/ui` ou équivalent (composants)
- `recharts` ou `tremor` (graphiques)
- `react-dnd` ou `@dnd-kit/core` (drag-and-drop modules de transport)
- `i18next` + `react-i18next` (internationalisation FR/EN/ES)

**Services tiers**

- **Odoo JSON-2 API** (v19) — endpoint `https://<instance>.odoo.com/jsonrpc`
- **Gamma API** — génération de devis et catalogues
- **DeepL API** ou **OpenAI API** — traduction multilingue

## 2.3 Conventions de code et structure projet

**Structure backend (Python Django + DRF)**

```jsx
backend/
├── apps/
│   ├── core/                    # BaseModel UUID, permissions, pagination
│   ├── products/                # Product, ProductSupplier (PIM)
│   ├── attributes/              # Registre EAV + valeurs JSONB
│   ├── clients/                 # Client (Odoo + prospects locaux)
│   ├── market/                  # TransportMode, MarketParameter (cuivre/FX)
│   ├── simulations/             # Simulation + Line + Recalculation
│   ├── offers/                  # Offer + OfferLine
│   ├── documents/               # Bibliothèque de PJ pour offres projet
│   ├── odoo_sync/               # OdooAdapter (base, v16, v19, factory) + SyncLog
│   └── data_migration/          # Quarantaine de migration initiale
├── config/                      # Projet Django
│   ├── settings/
│   │   ├── base.py              # Commun
│   │   ├── local.py             # Dev (DEBUG=True, CORS *)
│   │   └── production.py        # Prod (HTTPS, HSTS, Supabase)
│   ├── urls.py
│   ├── wsgi.py / asgi.py
│   └── celery.py
├── manage.py
├── pyproject.toml
└── .env.example
```

**Structure frontend (Next.js App Router)**

```
frontend/
├── app/
│   ├── (auth)/
│   │   └── login/
│   ├── (app)/
│   │   ├── catalog/             # PIM
│   │   ├── simulator/           # Moteur de prix
│   │   ├── offers/              # Génération + suivi
│   │   ├── clients/
│   │   └── settings/
│   ├── api/                     # Route handlers Next.js (proxy)
│   └── layout.tsx
├── components/
│   ├── ui/                      # shadcn/ui
│   ├── pricing/                 # Composants moteur de calcul
│   ├── pim/
│   └── offers/
├── lib/
│   ├── api-client.ts            # Client API typé
│   ├── i18n.ts
│   └── utils.ts
├── locales/
│   ├── fr.json
│   ├── en.json
│   └── es.json
└── public/
```

**Conventions**

- Code en **anglais** (variables, fonctions, commentaires)
- Termes métier français conservés tels quels (`pa_net`, `pamp`, `prix_de_revient`)
- Fichiers `snake_case` côté backend, `kebab-case` côté frontend
- Tests unitaires obligatoires sur le moteur de calcul
- Migrations Django versionnées (`python manage.py makemigrations`)
- Variables d'environnement via `.env` (jamais commit)

**Variables d'environnement clés**

```jsx
# Backend
DATABASE_URL=postgres://syskern:syskern@postgres:5432/syskern
SUPABASE_URL=https://....supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
ODOO_API_VERSION=v19              # v16 ou v19
ODOO_BASE_URL=https://...
ODOO_DB_NAME=...
ODOO_API_USER=...
ODOO_API_PASSWORD=...
GAMMA_API_KEY=...
DEEPL_API_KEY=...                 # ou OPENAI_API_KEY
APP_PASSWORD=...                  # mot de passe unique d'accès MVP1

# Frontend
NEXT_PUBLIC_API_URL=https://api.syskern-pricing.com
```

📌 **Décision archi** : la couche `adapters/odoo/` est l'unique point de contact avec Odoo. Le reste du backend ne connaît qu'une interface abstraite. Switch v16/v19 via la variable `ODOO_API_VERSION`.

---

# 3. Modèle de données

## 3.1 Vue d'ensemble des entités

**Entités principales :**

```
┌──────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Product     │───→│ ProductAttribute │←───│ AttributeRegistry│
│  (SKU)       │    │  Value (JSONB)   │    │  (définitions)   │
└──────┬───────┘    └──────────────────┘    └─────────────────┘
       │
       │ 1-N                       ┌─────────────────┐
       ├───────────────────────────│ ProductSupplier │
       │                           │  (1 actif/SKU)  │
       │                           └─────────────────┘
       │
       │ N-N via SimulationLine
       ▼
┌──────────────┐         ┌─────────────────┐
│  Simulation  │────────→│ SimulationLine  │
│  (snapshot   │   1-N   │ (résultats par  │
│   complet)   │         │   SKU)          │
└──────┬───────┘         └─────────────────┘
       │
       │ 1-N
       ▼
┌──────────────┐         ┌──────────────────┐
│    Offer     │────────→│   OfferLine      │
│  (tarif ou   │   1-N   │  (prix par SKU)  │
└──────┬───────┘         └──────────────────┘
       │ N-1                       
       ▼                           
┌──────────────┐                  
│   Client     │ (sync Odoo + prospects locaux)
└──────────────┘

┌──────────────────────────────────────┐
│ TransportMode (référentiel)          │
│ Incoterm (référentiel)               │
│ Currency (référentiel)               │
│ DocumentLibrary (CGV, garanties...)  │
│ MarketParameter (cours cuivre, FX)   │
└──────────────────────────────────────┘
```

## 3.2 Schéma SQL détaillé

### Table `products`

Représente un SKU. Lié 1-1 à un produit Odoo via `odoo_id`.

```sql
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    odoo_id INTEGER UNIQUE,                    -- ID dans Odoo (NULL si créé localement, sync ensuite)
    sku_code TEXT NOT NULL UNIQUE,             -- Référence commerciale (ex: KCFF6A4PZHDBL5)
    item_code TEXT,                            -- Code alphanumérique généré par Odoo
    parent_reference TEXT,                     -- Référence générique (ex: KPS600ZH) — nullable
    factory_code TEXT,                         -- Code usine (ex: 21, E02) — extrait du suffixe
    name TEXT NOT NULL,                        -- Désignation commerciale
    
    -- Hiérarchie produit (4 niveaux)
    universe TEXT,                             -- Ex: "Tube"
    family TEXT,                               -- Ex: "Câbles réseau"
    range TEXT,                                -- Ex: "Catégorie 7"
    sub_range TEXT,                            -- Ex: "Câble blindé"
    
    -- Marque
    brand TEXT,                                -- Unikkern, NextCorn, OEM, etc.
    
    -- Descriptions multilingues
    description_marketing JSONB,               -- {"fr": "...", "en": "...", "es": "..."}
    description_technical JSONB,               -- idem
    
    -- Identifiants externes
    hs_code TEXT,                              -- Code douanier
    gtin TEXT,                                 -- Code-barres EAN
    dop_number TEXT,                           -- Déclaration de performance
    
    -- Attributs cuivre (impactent le calcul de prix)
    is_copper_indexed BOOLEAN DEFAULT false,   -- Le prix est-il indexé sur le cuivre ?
    copper_weight_kg_per_unit NUMERIC(10,4),   -- Poids cuivre par unité (ex: 18 kg/km)
    base_unit TEXT DEFAULT 'unit',             -- 'unit', 'km', 'm', etc.
    
    -- Conditionnement (issu d'Odoo)
    primary_packaging_qty INTEGER,             -- Pièces par bag
    secondary_packaging_qty INTEGER,           -- Pièces par carton
    tertiary_packaging_qty INTEGER,            -- Pièces par carton master
    pallet_qty INTEGER,                        -- Pièces par palette
    unit_weight_kg NUMERIC(10,3),
    
    -- Approvisionnement
    supply_policy TEXT,                        -- 'buy', 'dropship', 'mixed'
    is_stockable BOOLEAN DEFAULT true,
    
    -- Stock & PAMP (synchronisés depuis Odoo)
    stock_quantity NUMERIC(12,3),
    pamp_eur NUMERIC(12,4),                    -- Prix d'achat moyen pondéré (snapshot Odoo)
    pamp_synced_at TIMESTAMPTZ,
    
    -- Métadonnées
    is_active BOOLEAN DEFAULT true,
    odoo_last_sync_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_products_sku ON products(sku_code);
CREATE INDEX idx_products_odoo ON products(odoo_id);
CREATE INDEX idx_products_hierarchy ON products(universe, family, range, sub_range);
CREATE INDEX idx_products_factory ON products(factory_code);
```

### Tables `attribute_registry` et `product_attribute_values`

Gèrent les attributs dynamiques. Le client peut ajouter de nouveaux champs sans migration de schéma.

```sql
-- Registre des attributs définis dynamiquement
CREATE TABLE attribute_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,                 -- Identifiant technique (ex: "shielding_type")
    label JSONB NOT NULL,                      -- {"fr": "Type de blindage", "en": "Shielding type", ...}
    category TEXT NOT NULL,                    -- 'structural' | 'technical' | 'marketing' | 'commercial' | 'logistic'
    data_type TEXT NOT NULL,                   -- 'text' | 'number' | 'boolean' | 'date' | 'select' | 'multiselect'
    options JSONB,                             -- Pour select/multiselect : [{"value": "...", "label": {...}}]
    unit TEXT,                                 -- Pour number : 'mm', 'kg', '°C', etc.
    is_required BOOLEAN DEFAULT false,
    is_searchable BOOLEAN DEFAULT true,        -- Indexé dans la recherche
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_attribute_registry_category ON attribute_registry(category);

-- Valeurs des attributs par produit (1 ligne par couple produit × attribut)
CREATE TABLE product_attribute_values (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    attribute_id UUID NOT NULL REFERENCES attribute_registry(id) ON DELETE CASCADE,
    value JSONB,                               -- Valeur typée selon attribute_registry.data_type
    UNIQUE(product_id, attribute_id)
);

CREATE INDEX idx_pav_product ON product_attribute_values(product_id);
CREATE INDEX idx_pav_attribute ON product_attribute_values(attribute_id);
-- Index GIN pour recherche dans value JSONB si besoin de full-text
CREATE INDEX idx_pav_value_gin ON product_attribute_values USING GIN (value);
```

📌 **Décision archi (rappel)** : pattern EAV avec valeurs en JSONB. Permet d'ajouter un attribut via UI sans migration SQL. Le typage des valeurs est porté par `attribute_registry.data_type`.

### Table `product_suppliers`

Gère les fournisseurs et leur paramétrage de calcul.

```sql
CREATE TABLE product_suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    supplier_name TEXT NOT NULL,               -- Ex: "Symea Shanghai"
    factory_code TEXT,                         -- Ex: "21", "E02"
    is_active BOOLEAN DEFAULT false,           -- Une seule source active à la fois pour les calculs
    
    -- Paramètres de calcul pré-remplis (modifiables au moment de la simulation)
    po_base_price NUMERIC(12,4),               -- Prix de base fournisseur (ex: 2350)
    po_currency TEXT NOT NULL DEFAULT 'RMB',   -- 'RMB', 'USD', 'EUR'
    is_copper_indexed BOOLEAN DEFAULT false,
    copper_base_price NUMERIC(12,2),           -- Base cuivre de référence (ex: 70000 RMB/tonne)
    incoterm TEXT,                             -- 'FOB', 'CIF', 'EXW', 'DDP', etc.
    incoterm_location TEXT,                    -- Ex: "Shanghai", "Le Havre"
    
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_product_suppliers_product ON product_suppliers(product_id);
-- Contrainte : une seule source active par produit
CREATE UNIQUE INDEX idx_product_suppliers_one_active 
    ON product_suppliers(product_id) WHERE is_active = true;
```

### Table `clients`

Mix de clients synchronisés depuis Odoo et de prospects créés localement.

```sql
CREATE TABLE clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    odoo_id INTEGER UNIQUE,                    -- NULL si prospect local
    is_prospect BOOLEAN DEFAULT false,
    
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    address_street TEXT,
    address_city TEXT,
    address_zip TEXT,
    address_country TEXT,
    
    -- Préférences commerciales
    preferred_currency TEXT,                   -- 'EUR', 'USD'
    preferred_incoterm TEXT,
    preferred_language TEXT DEFAULT 'fr',      -- 'fr', 'en', 'es'
    segment TEXT,                              -- 'Premium', 'Standard', 'Export'
    
    notes TEXT,
    odoo_last_sync_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_clients_odoo ON clients(odoo_id);
CREATE INDEX idx_clients_name ON clients(name);
```

### Tables `simulations` et `simulation_lines`

Historisent les calculs avec snapshot complet des paramètres et résultats.

```sql
CREATE TABLE simulations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    label TEXT NOT NULL,                       -- Nom donné par l'utilisateur
    simulation_type TEXT NOT NULL,             -- 'tariff' (tarif global) | 'project' (projet spécifique)
    
    -- Contexte
    client_ids UUID[] DEFAULT '{}',            -- Pour tarifs : N clients possibles
    project_name TEXT,                         -- Pour projets uniquement
    
    -- Paramètres marché (snapshot au moment du calcul)
    market_params JSONB NOT NULL,
    /* Structure :
    {
      "copper_base_price_rmb": 70000,
      "copper_current_price_rmb": 97000,
      "fx_eur_rmb": 7.95,    // 1 EUR = 7.95 RMB
      "fx_eur_usd": 1.15,    // 1 EUR = 1.15 USD
      "valid_from": "2026-04-28",
      "valid_to": "2026-07-28"
    }
    Tous les taux FX sont saisis à partir de l'EUR (convention "1 EUR = X devise").
    Les taux entre devises non-EUR (ex: USD→RMB) sont dérivés automatiquement.
    */
    
    -- Chaîne de modules de calcul (drag-and-drop ordonnable pour transports)
    calculation_chain JSONB NOT NULL,
    /* Structure :
    {
      "purchase_chain": [
        {"type": "transport", "order": 1, "params": {...}},
        {"type": "transport", "order": 2, "params": {...}},
        {"type": "customs", "order": 3, "params": {...}},
        {"type": "margin", "order": 4, "params": {"rate": 0.06}}
      ],
      "sale_chain": [...]  // Même structure pour le PV
    }
    */
    
    -- Mix stock/achat global (peut être surchargé par ligne)
    stock_purchase_mix_pct INTEGER DEFAULT 0,  -- % depuis le stock (0-100)
    
    -- Marges de référence
    symea_margin_rate NUMERIC(5,4) DEFAULT 0.06,
    syskern_margin_rate NUMERIC(5,4) DEFAULT 0.20,
    
    -- Métadonnées
    status TEXT DEFAULT 'draft',               -- 'draft', 'finalized'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_simulations_type ON simulations(simulation_type);
CREATE INDEX idx_simulations_created ON simulations(created_at DESC);

-- Une ligne par SKU dans la simulation (snapshot complet)
CREATE TABLE simulation_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    simulation_id UUID NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    
    -- Snapshot du produit au moment du calcul
    product_snapshot JSONB NOT NULL,           -- Copie du produit (sku, name, copper_weight, etc.)
    
    -- Snapshot des paramètres fournisseur utilisés
    supplier_snapshot JSONB NOT NULL,          -- Copie de product_suppliers actif
    
    -- Surcharges spécifiques à cette ligne
    margin_override NUMERIC(5,4),              -- Marge spécifique à ce produit (NULL = utilise la marge globale)
    stock_purchase_mix_pct_override INTEGER,   -- Override mix stock/achat
    
    -- Résultats du calcul (figés)
    po_net_origin_currency NUMERIC(12,4),      -- PO net en devise d'origine (ex: 2836 RMB)
    po_net_eur NUMERIC(12,4),                  -- PO net converti en EUR
    pa_net_eur NUMERIC(12,4),                  -- PA net DAP
    pamp_predictive_eur NUMERIC(12,4),         -- PAMP prévisionnel calculé
    pr_eur NUMERIC(12,4),                      -- Prix de revient (mix stock/achat)
    pv_eur NUMERIC(12,4),                      -- Prix de vente final
    
    -- Détail du calcul (pour audit/debug)
    calculation_breakdown JSONB,
    /* Structure :
    {
      "copper_variation_rmb": 486.00,
      "po_net_rmb": 2836,
      "po_net_eur": 356.73,
      "transport_1_eur_per_unit": 7.24,
      "transport_2_eur_per_unit": 2.78,
      "customs_eur": 0,
      "symea_margin_eur": 23.23,
      "final_pa_eur": 389.98
    }
    */
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_simulation_lines_sim ON simulation_lines(simulation_id);
CREATE INDEX idx_simulation_lines_product ON simulation_lines(product_id);
```

📌 **Décision archi (rappel)** : snapshot complet à chaque simulation. Si les données produit changent ensuite, la simulation historique reste cohérente.

### Tables `offers` et `offer_lines`

Représentent les offres générées (tarifaires ou projet).

```sql
CREATE TABLE offers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    simulation_id UUID REFERENCES simulations(id),
    offer_type TEXT NOT NULL,                  -- 'tariff' | 'project'
    label TEXT NOT NULL,
    
    -- Cibles
    client_ids UUID[] DEFAULT '{}',            -- Tarif : N clients ; Projet : 1 seul
    project_name TEXT,
    project_info JSONB,                        -- Infos libres sur le projet
    
    -- Paramètres
    currency TEXT NOT NULL,                    -- 'EUR', 'USD'
    incoterm TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'fr',
    
    -- Validité
    valid_from DATE,
    valid_to DATE,
    validity_duration_days INTEGER,            -- Pour offre projet
    
    -- Génération
    export_format TEXT NOT NULL,               -- 'excel', 'catalog' (tarif) ; 'devis_gamma', 'excel' (projet)
    ai_instructions TEXT,                      -- Prompt libre pour l'IA Gamma
    price_justification TEXT,                  -- Argumentaire tarifaire
    
    -- Documents joints (offre projet)
    attached_document_ids UUID[] DEFAULT '{}', -- FK vers document_library
    custom_attached_files JSONB,               -- [{"filename": "...", "storage_path": "..."}]
    
    -- Résultats
    generated_file_url TEXT,                   -- URL Supabase Storage du fichier final
    gamma_document_id TEXT,                    -- ID Gamma si applicable
    
    -- Suivi
    status TEXT DEFAULT 'draft',               -- 'draft', 'sent', 'won', 'lost', 'expired'
    sent_at TIMESTAMPTZ,
    won_at TIMESTAMPTZ,
    lost_at TIMESTAMPTZ,
    lost_reason TEXT,
    
    -- Versioning (offre projet uniquement)
    previous_offer_id UUID REFERENCES offers(id),  -- NULL pour V1, pointe vers V(n-1) pour les versions suivantes
    version_number INTEGER DEFAULT 1,              -- Calculé automatiquement à la création d'une révision
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_offers_type ON offers(offer_type);
CREATE INDEX idx_offers_status ON offers(status);
CREATE INDEX idx_offers_valid_to ON offers(valid_to);  -- Pour les alertes d'expiration
CREATE INDEX idx_offers_previous ON offers(previous_offer_id);  -- Pour reconstituer l'arbre des versions

CREATE TABLE offer_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    offer_id UUID NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    simulation_line_id UUID REFERENCES simulation_lines(id),
    
    -- Prix négocié pour cette offre (peut différer du PV de simulation après ajustement)
    final_price NUMERIC(12,4) NOT NULL,
    discount_pct NUMERIC(5,2),
    quantity NUMERIC(12,3),                    -- Pour offre projet
    
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_offer_lines_offer ON offer_lines(offer_id);
```

### Tables `transport_modes` et `incoterms` (référentiels)

```sql
CREATE TABLE transport_modes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,                 -- '40HQ', '20FT', 'TRUCK', 'AIR', 'EXPRESS'
    label JSONB NOT NULL,                      -- Multilingue
    category TEXT NOT NULL,                    -- 'maritime', 'road', 'air', 'rail'
    default_pallet_capacity INTEGER,           -- 40 pour 40HQ, 22 pour 20ft, etc.
    is_active BOOLEAN DEFAULT true
);

CREATE TABLE incoterms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,                 -- 'FOB', 'CIF', 'EXW', 'DDP', 'DAP', 'CFR', 'CPT', etc.
    label TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true
);
```

### Table `market_parameters` (cours cuivre, FX)

Historise les paramètres marché saisis manuellement.

```sql
CREATE TABLE market_parameters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parameter_type TEXT NOT NULL,              -- 'copper_price', 'fx_rate'
    
    -- Pour cuivre
    copper_market TEXT,                        -- 'LME', 'SHE'
    copper_price NUMERIC(12,2),
    copper_currency TEXT,                      -- 'RMB', 'USD'
    copper_unit TEXT DEFAULT 'tonne',
    
    -- Pour FX
    fx_from_currency TEXT,
    fx_to_currency TEXT,
    fx_rate NUMERIC(12,6),
    
    valid_from DATE NOT NULL,
    valid_to DATE,
    notes TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_market_params_type ON market_parameters(parameter_type, valid_from DESC);
```

### Table `document_library` (offres projet)

Bibliothèque de documents fixes joignables aux offres.

```sql
CREATE TABLE document_library (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name JSONB NOT NULL,                       -- Multilingue
    category TEXT NOT NULL,                    -- 'cgv', 'warranty', 'quality', 'project_reference', 'company', 'other'
    file_url TEXT NOT NULL,                    -- URL Supabase Storage
    file_size_bytes INTEGER,
    mime_type TEXT,
    language TEXT,                             -- Si document spécifique à une langue
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

## 3.3 Données de référence à pré-charger

Au déploiement initial, pré-remplir :

**`incoterms`** : EXW, FCA, FAS, FOB, CFR, CIF, CPT, CIP, DAP, DPU, DDP

**`transport_modes`** :

- 40HQ (maritime) — 40 palettes par défaut
- 40FT (maritime) — 40 palettes par défaut
- 20FT (maritime) — 22 palettes par défaut
- TRUCK_FULL (routier) — 33 palettes par défaut
- TRUCK_LCL (routier groupé) — saisie manuelle
- AIR_FREIGHT (aérien) — saisie manuelle
- EXPRESS (UPS, DHL...) — saisie manuelle

**`attribute_registry`** — attributs minimaux à créer dès l'init :

- `hs_code` (text, structural)
- `gtin` (text, structural)
- `dop_number` (text, structural)
- `unit_weight_kg` (number, logistic)
- `pallet_qty` (number, logistic)
- (la suite sera ajoutée par Olivier au fur et à mesure)

**`market_parameters`** : cours cuivre du jour + taux EUR/USD/RMB du jour à saisir au déploiement.

## 3.4 Stratégie de versioning

- **Produits** : pas de versioning, modifications en place. La traçabilité passe par les snapshots dans les simulations et offres.
- **Simulations** : immuables une fois `status = 'finalized'`. Si modification nécessaire → duplication.
- **Offres** : versioning par ré-émission. L'offre originale reste, une nouvelle est créée et liée par `previous_offer_id` (à ajouter si besoin).
- **Attributs (registry)** : modifications versionnées par `updated_at`. Si un attribut est supprimé, les `product_attribute_values` sont supprimés en cascade.

---

# 4. Brique 1 — PIM (Product Information Management)

## 4.1 Fonctionnalités

### 4.1.1 Consultation du catalogue

- Vue tableau avec pagination serveur (20-50 lignes/page)
- Tri par n'importe quelle colonne
- Recherche full-text sur : `sku_code`, `name`, `description_marketing`, `description_technical`, `parent_reference`
- Filtres combinables :
    - Par hiérarchie : Univers / Famille / Gamme / Sous-gamme (cascade)
    - Par marque
    - Par fourchette de prix (PV ou PAMP)
    - Par disponibilité stock (en stock / rupture / quantité minimale)
    - Par fournisseur (factory_code)
    - Par attribut dynamique (ex: type de blindage = S/FTP)
- Sauvegarde de filtres en favoris (persisté en local storage)
- Export Excel du résultat filtré

### 4.1.2 Vue détaillée d'un produit

Onglets distincts :

1. **Général** : champs core (nom, SKU, hiérarchie, marque, descriptions multilingues, identifiants)
2. **Technique** : attributs catégorisés "technical" depuis le registre
3. **Marketing** : attributs catégorisés "marketing" + descriptions enrichies
4. **Logistique** : poids, conditionnements, données palette
5. **Commercial** : fournisseur(s), PAMP stock, pricing actuel, historique 3-6 mois
6. **Médias** : ❌ **HORS SCOPE MVP1** — placeholder uniquement, structure DB prête

### 4.1.3 Création / édition de produit

- Création via formulaire structuré (champs core obligatoires + attributs dynamiques)
- Génération automatique de `parent_reference` proposée à partir du SKU (modifiable)
- Détection automatique du `factory_code` à partir du suffixe du SKU (regex sur `-XX`, `-EXX`, etc.)
- Validation des champs obligatoires avant sauvegarde
- Synchronisation vers Odoo en différé (queue de sync)
- Édition en place avec autosave (debounce 2s)

### 4.1.4 Gestion des attributs (admin du registre)

- Page dédiée `/settings/attributes`
- Liste des attributs avec catégorie, type, options, ordre d'affichage
- Création d'un attribut : code (snake_case auto), label multilingue, catégorie, type, options si applicable, unité, obligatoire, ordre
- Édition d'un attribut : tous les champs sauf le code (immuable)
- Suppression d'un attribut : confirmation explicite, suppression en cascade des `product_attribute_values` associées
- Réordonnancement par drag-and-drop dans une catégorie

### 4.1.5 Gestion des fournisseurs par produit

- Sous-page de la vue détaillée produit
- Liste des `product_suppliers` du SKU
- Bouton "Ajouter un fournisseur"
- Toggle "Source active" : un seul actif à la fois (UI gère la mutex)
- Champs par fournisseur : nom, code usine, prix de base, devise, indexation cuivre, base cuivre, incoterm, localisation
- Pré-remplissage par défaut lors de la création d'une simulation pour ce SKU

### 4.1.6 Historique des prix sur la fiche produit

**Onglet « Commercial » de la fiche produit** : un graphique léger affiche l'évolution des prix calculés pour ce SKU sur les **6 derniers mois**. Le graphique présente trois courbes :

- **PA net** (prix d'achat plateforme)
- **PR** (prix de revient avec mix stock/achat)
- **PV** (prix de vente)

Les points correspondent aux occurrences du SKU dans les `simulation_lines` des simulations en statut `finalized` créées sur la période. Pour chaque date, la valeur affichée est celle issue de la simulation finalisée la plus récente à cette date.

**Période affichée** : 6 mois glissants par défaut, avec un toggle pour afficher 3 mois ou 12 mois.

**Cas où l'historique est vide** : si aucune simulation finalisée n'a inclus ce SKU sur la période, le graphique affiche un message neutre "Aucun historique disponible sur la période". Pas d'erreur.

**Implementation** : requête agrégée sur `simulation_lines` jointe à `simulations` filtrées par `status = 'finalized'` et `created_at` dans la fenêtre temporelle. Triée par date décroissante. Pas de cache : la requête est exécutée à l'ouverture de l'onglet, le volume reste raisonnable même avec plusieurs centaines de simulations.

**Endpoint API** :

```
GET /api/products/{id}/price-history?period=6m  # 'période' : '3m', '6m', '12m'
```

Retourne un array de points `[{date, pa_eur, pr_eur, pv_eur, simulation_id, simulation_label}, ...]` permettant au frontend de tracer le graphique avec un tooltip qui renvoie vers la simulation source de chaque point.

## 4.2 Règles métier

### Hiérarchie produit

- Les 4 niveaux (univers, famille, gamme, sous-gamme) sont stockés en TEXT (pas de table de référentiel séparée pour le MVP1).
- Les valeurs distinctes existantes alimentent les filtres en cascade (DISTINCT au runtime).
- Olivier peut introduire de nouvelles valeurs en saisie libre. Pas de validation contre une liste fermée.

### Référence générique (parent_reference)

- Optionnelle. Un SKU peut ne pas en avoir.
- Plusieurs SKU peuvent partager la même `parent_reference`.
- Convention de génération automatique proposée : extraction du préfixe avant les 2-3 derniers caractères de spécification (longueur, couleur).
- L'utilisateur peut toujours surcharger la valeur proposée.

### Code usine (factory_code)

- Extrait automatiquement du suffixe du SKU si présent.
- Format attendu : `-NN` ou `-ENN` (ex: `-21`, `-E02`).
- Si non détecté, champ vide. L'utilisateur peut le saisir manuellement.
- Sert à pré-remplir le `factory_code` du `ProductSupplier` actif.

### Indexation cuivre (is_copper_indexed)

- Si `true` : le calcul de prix appliquera la formule de variation cuivre lors des simulations.
- Si `false` : le PO est utilisé tel quel, pas de variation cuivre.
- Détection automatique proposée : si la fiche produit définit un `copper_weight_kg_per_unit` > 0, alors `is_copper_indexed = true` par défaut.
- Surcharge manuelle possible.

### Multilangue

- Les descriptions sont stockées en JSONB `{"fr": "...", "en": "...", "es": "..."}`.
- Une langue manquante affiche un placeholder "non traduit" dans l'UI.
- Bouton "Traduire automatiquement" disponible : appelle DeepL/OpenAI sur la version source (FR par défaut) et remplit les autres langues.
- L'utilisateur peut toujours éditer les traductions générées.

## 4.3 Écrans (description verbale)

### Écran 1 — Catalogue (`/catalog`)

```
┌──────────────────────────────────────────────────────────────────────┐
│ [Header avec recherche globale]   [Bouton + Nouveau produit]         │
├──────────────────────────────────────────────────────────────────────┤
│ ┌──────────────┐ ┌─────────────────────────────────────────────────┐ │
│ │ Filtres      │ │ Liste tableau                                   │ │
│ │              │ │                                                 │ │
│ │ ▶ Hiérarchie │ │ [✓] SKU  | Nom | Gamme | Stock | PAMP | Actions│ │
│ │   Univers    │ │  ...                                            │ │
│ │   Famille    │ │  ...                                            │ │
│ │   Gamme      │ │                                                 │ │
│ │   Sous-gamme │ │                                                 │ │
│ │              │ │                                                 │ │
│ │ ▶ Marque     │ │                                                 │ │
│ │ ▶ Fournisseur│ │                                                 │ │
│ │ ▶ Stock      │ │                                                 │ │
│ │ ▶ Attributs  │ │                                                 │ │
│ │   (dynamique)│ │                                                 │ │
│ │              │ │                                                 │ │
│ │ [Sauvegarder │ │                                                 │ │
│ │  filtre]     │ │                                                 │ │
│ └──────────────┘ │ [Pagination]                                    │ │
│                  │ [Bouton: Exporter Excel sélection]              │ │
│                  └─────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

**Comportement attendu** :

- Sidebar gauche fixe (sticky) avec filtres collapsibles par section
- Tableau central avec colonnes redimensionnables
- Sélection multiple via checkbox pour actions groupées (export, ajout à simulation)
- Header de tableau cliquable pour tri (chevron up/down)
- Lien sur le SKU pour ouvrir la vue détaillée dans un slide-over (drawer) ou nouvel onglet

### Écran 2 — Vue détaillée produit (`/catalog/[sku]`)

Layout en 2 colonnes :

- **Gauche (1/3)** : informations clés en lecture rapide (SKU, nom, hiérarchie, marque, image placeholder, stock actuel, PAMP, prix de vente actuel)
- **Droite (2/3)** : onglets (Général, Technique, Marketing, Logistique, Commercial, Médias)

Chaque onglet contient des sections collapsibles. Les attributs dynamiques sont rendus selon `data_type` :

- `text` : input simple ou textarea selon longueur
- `number` : input numérique avec unité affichée à droite
- `boolean` : toggle
- `date` : date picker
- `select` : dropdown
- `multiselect` : tags input

Bouton "Modifier" en haut à droite passe l'onglet en mode édition. Autosave.

Boutons d'action en pied de page :

- "Voir dans Odoo" (lien direct vers l'instance)
- "Ajouter à une simulation"
- "Historique des modifications" (toggle qui ouvre un panneau latéral) — ❌ HORS SCOPE MVP1

### Écran 3 — Gestion des attributs (`/settings/attributes`)

Vue tableau simple :

- Colonnes : Code, Label (FR), Catégorie, Type, Obligatoire, Ordre, Actions
- Bouton "+ Nouvel attribut" en haut à droite ouvre une modale
- Filtres par catégorie en chips au-dessus du tableau
- Drag handle à gauche de chaque ligne pour réordonner dans une même catégorie

Modale de création/édition :

- Champs : code (auto-généré depuis label, modifiable), labels FR/EN/ES, catégorie (select), type (select), options (si select/multiselect — éditeur de liste), unité, obligatoire, recherchable

### Écran 4 — Création de produit (`/catalog/new`)

Wizard en étapes :

1. **Identification** : SKU, nom, descriptions FR/EN/ES, hiérarchie
2. **Caractéristiques techniques** : attributs catégorie "technical"
3. **Logistique** : conditionnement, palette, poids
4. **Fournisseur(s)** : ajout de la première source
5. **Validation** : récapitulatif + bouton "Créer et synchroniser vers Odoo"

En alternative pour utilisateur expérimenté : mode "formulaire complet sur une page" via toggle.

## 4.4 Endpoints API internes

### Produits

```
GET    /api/products                    # Liste paginée + filtres
GET    /api/products/{sku_or_id}        # Détail d'un produit
POST   /api/products                    # Création
PATCH  /api/products/{id}               # Mise à jour partielle
DELETE /api/products/{id}               # Soft delete (is_active = false)

GET    /api/products/{id}/attributes    # Tous les attributs valorisés
PUT    /api/products/{id}/attributes/{attribute_id}   # Set valeur
DELETE /api/products/{id}/attributes/{attribute_id}   # Suppression valeur

GET    /api/products/{id}/suppliers     # Liste des fournisseurs du SKU
POST   /api/products/{id}/suppliers     # Ajout d'un fournisseur
PATCH  /api/products/{id}/suppliers/{supplier_id}     # Mise à jour
POST   /api/products/{id}/suppliers/{supplier_id}/activate   # Active cette source (désactive les autres)
DELETE /api/products/{id}/suppliers/{supplier_id}

POST   /api/products/{id}/translate     # Génère traductions manquantes via IA
POST   /api/products/export             # Export Excel (body = filtres)
```

### Registre d'attributs

```
GET    /api/attributes                  # Liste du registre
POST   /api/attributes                  # Création
PATCH  /api/attributes/{id}
DELETE /api/attributes/{id}
POST   /api/attributes/reorder          # Réordonnancement (body: array d'IDs ordonnés)
```

### Référentiel

```
GET    /api/hierarchy/distinct?level=universe   # Valeurs distinctes pour filtres cascade
GET    /api/brands                              # Marques distinctes
GET    /api/factory-codes                       # Codes usine distincts
```

## 4.5 Règles de validation

**Création/édition produit :**

- `sku_code` obligatoire, unique, regex `^[A-Z0-9-]+$`, max 64 caractères
- `name` obligatoire, max 255 caractères
- `description_marketing.fr` obligatoire (les autres langues optionnelles)
- `copper_weight_kg_per_unit` > 0 si `is_copper_indexed = true`
- Au moins 1 ligne dans `product_suppliers` pour pouvoir activer le SKU dans une simulation (warning, pas blocage)

**Création d'attribut :**

- `code` obligatoire, unique, regex `^[a-z][a-z0-9_]*$`, max 64 caractères
- `label.fr` obligatoire
- Si `data_type = 'select' | 'multiselect'` : au moins 1 option dans `options`
- `category` doit être dans la liste fixe : `structural | technical | marketing | commercial | logistic`

## 4.6 Cas particuliers et edge cases

- **Suppression d'un produit** : soft delete uniquement (`is_active = false`). Les simulations historiques restent valides grâce aux snapshots. La synchro Odoo passe le produit en archived côté Odoo (pas de suppression dure).
- **Conflit de SKU** : si Odoo crée un nouveau produit avec un SKU existant côté plateforme : afficher un warning de conflit dans une queue de réconciliation (page `/settings/sync-conflicts`). Pas de merge automatique.
- **Attribut renommé après création** : impossible, le `code` est immuable. Pour renommer, créer un nouveau code + migration manuelle.
- **Volumétrie filtre cascade** : si une `gamme` contient > 500 sous-gammes, paginer le dropdown.
- **Recherche full-text** : utiliser `tsvector` Postgres avec dictionnaire `french` + `simple` pour multilangue.

---

# 5. Brique 2 — Intégration Odoo (dual v16/v19)

## 5.1 Architecture de la couche d'abstraction

📌 **Décision archi structurante** : tout le code métier ignore qu'Odoo existe. Il ne parle qu'à une interface `OdooAdapter` abstraite. Deux implémentations concrètes : `OdooAdapterV16` et `OdooAdapterV19`. Le choix de l'implémentation se fait au démarrage de l'application via la variable d'environnement `ODOO_API_VERSION`.

### Interface abstraite

```python
from abc import ABC, abstractmethod
from typing import Optional
from datetime import datetime
from apps.odoo_sync.schemas import OdooProduct, OdooStock, OdooClient, OdooSupplier

class OdooAdapter(ABC):
    """Interface abstraite pour communiquer avec Odoo (v16 ou v19).
    
    Toutes les méthodes sont async. Les retours sont normalisés via les schemas
    Pydantic dans app.schemas.odoo, indépendants de la version Odoo.
    """
    
    # ─────────────── Auth & Health ─────────────────
    @abstractmethod
    async def authenticate(self) -> None:
        """Établit la session. Lève AuthenticationError si échec."""
    
    @abstractmethod
    async def health_check(self) -> bool:
        """Vérifie la disponibilité d'Odoo. True si OK."""
    
    # ─────────────── Produits ──────────────────────
    @abstractmethod
    async def list_products(
        self, 
        modified_since: Optional[datetime] = None,
        limit: int = 100,
        offset: int = 0
    ) -> list[OdooProduct]: ...
    
    @abstractmethod
    async def get_product(self, odoo_id: int) -> OdooProduct: ...
    
    @abstractmethod
    async def create_product(self, product: OdooProduct) -> int:
        """Retourne l'odoo_id du produit créé."""
    
    @abstractmethod
    async def update_product(self, odoo_id: int, fields: dict) -> None: ...
    
    # ─────────────── Stock ─────────────────────────
    @abstractmethod
    async def get_stock_quantities(
        self, 
        odoo_product_ids: list[int]
    ) -> dict[int, OdooStock]:
        """Retourne {odoo_id: OdooStock} avec quantité dispo + PAMP."""
    
    # ─────────────── Achats engagés ────────────────
    @abstractmethod
    async def get_pending_purchases(
        self, 
        odoo_product_ids: list[int]
    ) -> dict[int, list[dict]]:
        """Retourne {odoo_id: [{quantity, price_unit, expected_date}, ...]}.
        Utilisé pour le calcul du PAMP prévisionnel."""
    
    @abstractmethod
    async def get_pending_sales(
        self, 
        odoo_product_ids: list[int]
    ) -> dict[int, list[dict]]:
        """Retourne {odoo_id: [{quantity, price_unit, expected_date}, ...]}."""
    
    # ─────────────── Clients ───────────────────────
    @abstractmethod
    async def list_clients(
        self,
        modified_since: Optional[datetime] = None,
        limit: int = 100,
        offset: int = 0
    ) -> list[OdooClient]: ...
    
    @abstractmethod
    async def get_client(self, odoo_id: int) -> OdooClient: ...
    
    # ─────────────── Fournisseurs ──────────────────
    @abstractmethod
    async def list_suppliers(self) -> list[OdooSupplier]: ...
```

### Factory de sélection

```python
# apps/odoo_sync/adapters/factory.py
from django.conf import settings
from apps.odoo_sync.adapters.base import OdooAdapter
from apps.odoo_sync.adapters.v16 import OdooAdapterV16
from apps.odoo_sync.adapters.v19 import OdooAdapterV19

def get_odoo_adapter() -> OdooAdapter:
    """Retourne l'adapter Odoo selon ODOO_API_VERSION."""
    if settings.odoo_api_version == "v16":
        return OdooAdapterV16(
            base_url=settings.odoo_base_url,
            db_name=settings.odoo_db_name,
            user=settings.odoo_api_user,
            password=settings.odoo_api_password,
        )
    elif settings.odoo_api_version == "v19":
        return OdooAdapterV19(
            base_url=settings.odoo_base_url,
            db_name=settings.odoo_db_name,
            user=settings.odoo_api_user,
            password=settings.odoo_api_password,
        )
    else:
        raise ValueError(f"Unsupported ODOO_API_VERSION: {settings.odoo_api_version}")
```

Le reste du code utilise la factory injectée dans les viewsets DRF.

## 5.2 Spécificités v16 vs v19

### Odoo v16 — XML-RPC / JSON-RPC classique

- **Protocole** : XML-RPC ou JSON-RPC sur `/xmlrpc/2/object` ou `/jsonrpc`
- **Pattern d'appel** : `execute_kw(db, uid, password, model, method, args, kwargs)`
- **Méthodes principales** : `search_read`, `create`, `write`, `unlink`
- **Contexte** : passé via le paramètre `context` (langue, fuseau horaire)
- **Domain** : liste de tuples `[('field', 'operator', 'value')]`
- **Pagination** : via `limit` et `offset` dans `search_read`

Librairie Python recommandée : `odoorpc` ou client custom basé sur `httpx`.

### Odoo v19 — JSON-2 API

- **Protocole** : nouvelle API JSON-2 documentée à `https://www.odoo.com/documentation/19.0/developer/reference/external_api.html`
- **Endpoints REST-like** sur `/json/2/`
- **Authentification** : token bearer obtenu via `/json/2/auth`
- **Pattern d'appel** : POST avec body JSON `{"context": {...}, "domain": [...], "fields": [...]}`

Librairie Python : client custom basé sur `httpx` (la communauté n'a pas encore stabilisé de SDK pour la v19).

### Différences notables connues

| Aspect | v16 | v19 |
| --- | --- | --- |
| Auth | login + uid + password | Token bearer |
| Format requête | XML-RPC ou JSON-RPC v1 | JSON-2 |
| Endpoint | `/xmlrpc/2/object` ou `/jsonrpc` | `/json/2/<resource>` |
| Domain syntax | Identique | Identique |
| Modèles produit | `product.template`  • `product.product` | Identique |
| `standard_price` (PAMP) | Disponible | Disponible |

**Champs à mapper identiquement entre v16 et v19** :

- `product.template` : `name`, `default_code` (= `sku_code`), `categ_id`, `barcode` (= GTIN), `weight`, `volume`, `description`, `description_purchase`, `description_sale`, `standard_price`
- `stock.quant` : `quantity`, `available_quantity`, `location_id`, `product_id`
- `res.partner` : `name`, `email`, `phone`, `street`, `city`, `zip`, `country_id`, `lang`, `customer_rank`, `supplier_rank`

Les champs custom Syskern (`x_*`) éventuels sont identifiés lors de la phase d'investigation du staging v16, documentés, et intégrés au mapping si pertinents.

## 5.3 Mapping des données Odoo ↔ Plateforme

### Sens Odoo → Plateforme (lecture, sync quotidienne)

| Champ Odoo (`product.template`) | Champ plateforme (`products`) | Notes |
| --- | --- | --- |
| `id` | `odoo_id` | Clé de matching |
| `default_code` | `sku_code` |  |
| `name` | `name` |  |
| `categ_id.name` (rollup hiérarchie) | `universe`, `family`, `range`, `sub_range` | Parser le path `Univers / Famille / Gamme / Sous-gamme` |
| `description_sale` | `description_marketing.fr` | FR par défaut |
| `description` | `description_technical.fr` |  |
| `barcode` | `gtin` |  |
| `weight` | `unit_weight_kg` |  |
| `standard_price` | `pamp_eur` |  |
| `qty_available` (depuis `stock.quant`) | `stock_quantity` |  |
| `seller_ids` | `product_suppliers` (init) | Au premier sync uniquement |

**HS Code, item code, code usine** : ces champs sont stockés côté plateforme dans la table `products`. Le mapping vers Odoo se fait uniquement si les champs natifs ou custom existent dans l'instance Syskern (à documenter par Boldys lors de la phase d'investigation initiale du staging).

### Sens Plateforme → Odoo (écriture, à la création/modification)

| Champ plateforme | Champ Odoo | Quand |
| --- | --- | --- |
| `sku_code` | `default_code` | Création + update |
| `name` | `name` | Création + update |
| `description_marketing.fr` | `description_sale` | Update |
| `description_technical.fr` | `description` | Update |
| `unit_weight_kg` | `weight` | Update |
| `gtin` | `barcode` | Update |

**Hors scope MVP1** : le push des prix calculés (PV) vers `product.pricelist` Odoo n'est pas implémenté. L'export prix vers Odoo se fait manuellement via fichier Excel généré par la plateforme (voir Brique 4 — Génération d'offres).

📌 **Décision archi** : les attributs dynamiques (`product_attribute_values`) ne sont pas poussés vers Odoo. Ils restent côté plateforme uniquement. Odoo conserve uniquement les champs structurants standards.

## 5.4 Flux de synchronisation

### 5.4.1 Synchronisation automatique quotidienne (cron)

- **Horaire** : 03:00 UTC (heure creuse)
- **Stratégie** : delta basé sur `write_date` Odoo
- **Pseudo-code** :

```python
async def daily_sync():
    last_sync = await db.get_last_sync_timestamp()
    
    # 1. Pull produits modifiés
    products = await odoo.list_products(modified_since=last_sync)
    for odoo_product in products:
        await upsert_product_from_odoo(odoo_product)
    
    # 2. Pull stock et PAMP
    stocks = await odoo.get_stock_quantities([p.odoo_id for p in products])
    for odoo_id, stock in stocks.items():
        await update_product_stock(odoo_id, stock)
    
    # 3. Pull clients modifiés
    clients = await odoo.list_clients(modified_since=last_sync)
    for odoo_client in clients:
        await upsert_client_from_odoo(odoo_client)
    
    # 4. Pull achats/ventes engagés (pour PAMP prévisionnel)
    # → seulement les SKU actifs avec stock > 0
    
    await db.set_last_sync_timestamp(datetime.utcnow())
    await log_sync_result(...)
```

Utiliser un job scheduler : `Celery Beat` (`django-celery-beat`, tâche périodique configurée dans `CELERY_BEAT_SCHEDULE`).

### 5.4.2 Synchronisation manuelle (bouton UI)

- Page `/settings/odoo-sync`
- Bouton "Synchroniser maintenant"
- Modal avec choix du périmètre :
    - Tout (produits + stock + clients + achats/ventes)
    - Produits uniquement
    - Stock uniquement
    - Clients uniquement
- Affichage du résultat : nombre d'éléments créés / mis à jour / en erreur
- Historique des syncs (table `sync_logs` à créer)

### 5.4.3 Synchronisation à la demande (création produit)

Lors de la création d'un produit dans la plateforme :

1. Sauvegarde locale en BDD (status `pending_odoo_sync`)
2. Appel async à `odoo.create_product()`
3. Récupération de l'`odoo_id` retourné
4. Mise à jour du produit local avec l'`odoo_id` (status `synced`)
5. Si échec : status `sync_failed`, le produit reste utilisable côté plateforme, retry périodique

### Table `sync_logs`

```sql
CREATE TABLE sync_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_type TEXT NOT NULL,                   -- 'auto_daily', 'manual', 'on_demand'
    scope TEXT NOT NULL,                       -- 'all', 'products', 'stock', 'clients', etc.
    odoo_api_version TEXT NOT NULL,            -- 'v16' ou 'v19' (pour audit)
    started_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    status TEXT NOT NULL,                      -- 'running', 'success', 'partial_failure', 'failed'
    items_created INTEGER DEFAULT 0,
    items_updated INTEGER DEFAULT 0,
    items_failed INTEGER DEFAULT 0,
    errors JSONB,                              -- [{item_id, error_message}, ...]
    triggered_by TEXT                          -- 'system' ou 'manual'
);
```

## 5.5 Gestion des erreurs

### Stratégie d'erreurs API

- **Erreur d'authentification** : retry 1 fois avec ré-authentification, puis échec → notification UI + log dans `sync_logs`
- **Timeout** : timeout HTTP fixé à 30s par appel, retry 3 fois avec backoff exponentiel (2s, 4s, 8s)
- **Erreur 5xx Odoo** : retry comme timeout
- **Erreur 4xx** : pas de retry, log de l'erreur, marquage de l'item en `sync_failed`
- **Rate limiting** : si headers de rate limit présents, respecter le `Retry-After`
- **Indisponibilité prolongée (>24h)** : sync en échec affiché sur `/settings/odoo-sync`, l'utilisateur est informé, aucun fallback automatique. La plateforme reste utilisable avec les données du dernier sync réussi.

## 5.6 Gestion des conflits de modification

**Règle simple MVP1 (last-write-wins avec préférence Odoo)** :

- Si un produit est modifié simultanément côté plateforme et côté Odoo, la version Odoo gagne au prochain sync.
- Exception : les attributs dynamiques (registry) ne sont jamais écrasés (ils n'existent pas dans Odoo).
- Les modifications côté plateforme entre 2 syncs sont poussées via `update_product` lors du sync suivant.

Pas de gestion fine des conflits en MVP1.

## 5.7 Endpoints API internes Odoo

```jsx
POST   /api/odoo/sync/trigger           # Déclenche une sync manuelle (body: scope)
GET    /api/odoo/sync/status            # Statut du dernier sync + sync en cours
GET    /api/odoo/sync/logs              # Historique paginé
GET    /api/odoo/health                 # Test de connectivité

# Endpoints internes (utilisés par le moteur de calcul, pas exposés UI)
GET    /api/odoo/products/{odoo_id}/pending-purchases
GET    /api/odoo/products/{odoo_id}/pending-sales
```

## 5.8 Configuration et secrets

Variables d'environnement dédiées :

```
ODOO_API_VERSION=v19                   # 'v16' ou 'v19'
ODOO_BASE_URL=https://syskern-odoo-boldys-test-31443618.dev.odoo.com
ODOO_DB_NAME=syskern-odoo-boldys-test-31443618
ODOO_API_USER=yassine@boldys.ai
ODOO_API_PASSWORD=...
ODOO_TIMEOUT_SECONDS=30
ODOO_SYNC_HOUR_UTC=3                   # Heure du cron quotidien
ODOO_SYNC_ENABLED=true                 # Killswitch pour désactiver le cron
```

En production : 2 sets de variables (16 et 19) avec switch via `ODOO_API_VERSION`. Permet de tester la bascule sans redéployer.

## 5.9 Tests et validation

**Tests unitaires obligatoires sur :**

- Mapping Odoo → Plateforme (chaque champ)
- Mapping Plateforme → Odoo
- Parsing de la hiérarchie produit depuis `categ_id.name`
- Détection de `factory_code` depuis `sku_code`
- Stratégie de retry et timeout

**Tests d'intégration sur les 2 instances Odoo fournies :**

- Lecture liste produits
- Création d'un produit de test
- Modification d'un produit
- Lecture stock + PAMP
- Lecture clients
- Erreurs simulées (timeout, 401, 500)

**Tests dual v16/v19 :**

- Suite de tests paramétrée qui s'exécute sur les 2 versions
- Assertion que les retours sont identiques (modulo les champs qui n'existent pas dans une version)

## 5.10 Phase d'investigation initiale (à réaliser avant le développement de la brique)

Avant le développement de l'OdooAdapter, Boldys réalise une phase d'investigation sur les instances de test fournies (Odoo 16 staging avec données Syskern + Odoo 19 demo). Livrables de cette phase :

1. **Document de mapping des champs Syskern** : liste exhaustive des champs `product.template` utilisés par Syskern, incluant les champs custom (`x_*`) s'ils existent.
2. **Schéma de la hiérarchie produit** : format exact de stockage de l'arborescence Univers / Famille / Gamme / Sous-gamme dans Odoo (path dans `categ_id` ou champs séparés).
3. **Mécanisme de stockage du HS Code et du code usine** : champ standard ou custom, format.
4. **Disponibilité des webhooks Odoo** : liste des événements supportés. Si non disponibles, la sync repose uniquement sur le cron quotidien et le bouton manuel.
5. **Mesure de volumétrie** : temps de réponse pour un pull complet de ~2000 SKU sur l'instance de test.

Cette phase est intégrée au temps de développement de la brique et conditionne les décisions de mapping finales.

---

# 6. Brique 3 — Moteur de calcul de prix (PA / PR / PV)

Le moteur de calcul est le cœur fonctionnel de la plateforme. Il calcule le **Prix d'Achat (PA)**, le **Prix de Revient (PR)** et le **Prix de Vente (PV)** pour chaque SKU à partir de paramètres marché (cours cuivre, taux de change), de la chaîne logistique (transports, douane) et des marges (Symea, Syskern).

L'utilisateur lance des **simulations** sur des sous-ensembles de produits pour des cas d'usage : tarif catalogue, tarif client spécifique, ou cotation projet.

## 6.1 Vocabulaire et définitions

| Terme | Définition |
| --- | --- |
| **PO net** | PO recalculé avec le cours cuivre actuel. Toujours en devise d'origine. |
| **Incoterm** | Terme international du commerce qui définit à quel point de la chaîne logistique le coût est exprimé (FOB, CIF, EXW, DDP, etc.). |
| **PAMP** | Prix d'Achat Moyen Pondéré. Moyenne pondérée des PA des achats engagés. Calculé par Odoo, utilisé comme prix de revient du stock. |
| **Mix stock/achat** | Pourcentage du PR provenant du stock (PAMP) vs. du nouveau PA. Paramètre commercial. |
| **Marge Symea** | Marge interne du groupe Symea, par défaut 6%. Diviseur dans la formule (`PR = X / (1 - marge)`). |
| **PV (Prix de vente)** | Prix final proposé au client, dans la devise et l'incoterm de vente. |

**Devises supportées** : EUR, USD, RMB. Toutes les conversions sont saisies manuellement par l'utilisateur (cf. §6.3.2).

## 6.2 Architecture du moteur

📌 **Décision archi structurante** : le moteur de calcul est une chaîne de **modules de calcul** ordonnés. Chaque module prend en entrée un prix (avec sa devise) et le contexte de simulation, et retourne un prix transformé accompagné des métadonnées du calcul.

### Types de modules

```python
from abc import ABC, abstractmethod
from enum import Enum

class ModuleType(str, Enum):
    COPPER_VARIATION = "copper_variation"        # Variation cuivre depuis la base
    CURRENCY_CONVERSION = "currency_conversion"  # Conversion entre devises
    TRANSPORT = "transport"                       # Module de transport (maritime, routier...)
    CUSTOMS = "customs"                           # Droits de douane
    MARGIN = "margin"                             # Application d'une marge (Symea ou Syskern)

class CalculationModule(ABC):
    """Module élémentaire de la chaîne de calcul."""
    
    @abstractmethod
    def apply(self, input_price: PriceWithCurrency, context: SimulationContext) -> CalculationStep:
        """Applique le module au prix d'entrée et retourne un CalculationStep
        contenant le prix de sortie et les métadonnées du calcul."""
```

### Chaîne PA — ordre défini

L'ordre de la chaîne PA est :

```
[PO base] → COPPER_VARIATION → CURRENCY_CONVERSION → TRANSPORT(s) → CUSTOMS → MARGIN(Symea) = PA net
```

**Modules empilables ou configurables** :

- `TRANSPORT` : 0 à N modules empilés séquentiellement, dans l'ordre saisi par l'utilisateur
- `CUSTOMS` : 0 ou 1 module, position fixe (après les transports, avant la marge)
- `MARGIN` Symea : exactement 1 module, taux configurable

📌 **Position relative de la marge Symea** : par défaut, la marge s'applique après tous les transports. L'utilisateur peut, via un toggle dans l'UI, la placer avant les transports. C'est le seul déplacement autorisé sur la position de la marge en MVP1.

### Chaîne PV — même logique, côté vente

```
[PR] → TRANSPORT(s) côté vente → CUSTOMS côté vente → MARGIN(Syskern) = PV final
```

Les modules côté vente sont indépendants des modules côté achat. Configuration séparée dans la simulation.

### Représentation de la chaîne en JSON

Stockée dans `simulations.calculation_chain` :

```json
{
  "purchase_chain": {
    "copper_variation": {
      "copper_base_price_rmb": 70000,
      "copper_current_price_rmb": 97000
    },
    "currency_conversion": {
      "to_currency": "EUR"
    },
    "transports": [
      {
        "order": 1,
        "transport_mode_code": "40HQ",
        "category": "maritime",
        "global_cost": 3000,
        "currency": "USD",
        "pallet_count": 40,
        "from_location": "Shanghai",
        "to_location": "Le Havre",
        "override_coefficient": null
      },
      {
        "order": 2,
        "transport_mode_code": "TRUCK_FULL",
        "category": "road",
        "global_cost": 1000,
        "currency": "EUR",
        "pallet_count": 40,
        "from_location": "Le Havre",
        "to_location": "Réau",
        "override_coefficient": null
      }
    ],
    "customs": {
      "global_cost": 0,
      "currency": "EUR"
    },
    "symea_margin": {
      "rate": 0.06,
      "position": "after_transports"
    }
  },
  "sale_chain": {
    "transports": [],
    "customs": null,
    "syskern_margin": {
      "rate": 0.20
    }
  }
}
```

## 6.3 Modules de calcul — spécifications détaillées

### 6.3.1 Module COPPER_VARIATION — Variation cuivre

**Entrée** : `PO_base` (prix de base fournisseur dans la devise d'origine) + contexte (cours cuivre base et actuel, poids cuivre du SKU).

**S'applique uniquement si** `product.is_copper_indexed = true` ET `product.copper_weight_kg_per_unit > 0`. Sinon, le module est by-passé (le prix passe inchangé).

**Formule** :

```
variation_per_unit (devise origine) = 
    (copper_current_price - copper_base_price) × copper_weight_kg_per_unit / 1000

PO_net (devise origine) = PO_base + variation_per_unit
```

**Pourquoi diviser par 1000** : le cours cuivre est en `<devise>/tonne`, le poids cuivre est en `kg/unité`. Conversion : 1 tonne = 1000 kg.

**Pseudo-code** :

```python
from decimal import Decimal

class CopperVariationModule(CalculationModule):
    def __init__(self, copper_base_price: Decimal, copper_current_price: Decimal):
        self.copper_base_price = copper_base_price
        self.copper_current_price = copper_current_price
    
    def apply(self, input_price: PriceWithCurrency, context: SimulationContext) -> CalculationStep:
        product = context.product
        
        if not product.is_copper_indexed or product.copper_weight_kg_per_unit <= 0:
            return CalculationStep(
                module_type=ModuleType.COPPER_VARIATION,
                input_price=input_price,
                output_price=input_price,
                metadata={"applied": False, "reason": "not_copper_indexed"}
            )
        
        variation = (
            (self.copper_current_price - self.copper_base_price) 
            * product.copper_weight_kg_per_unit 
            / Decimal(1000)
        )
        
        new_price = input_price.amount + variation
        
        return CalculationStep(
            module_type=ModuleType.COPPER_VARIATION,
            input_price=input_price,
            output_price=PriceWithCurrency(new_price, input_price.currency),
            metadata={
                "applied": True,
                "copper_base": self.copper_base_price,
                "copper_current": self.copper_current_price,
                "copper_weight_kg": product.copper_weight_kg_per_unit,
                "variation": variation,
            }
        )
```

### 6.3.2 Module CURRENCY_CONVERSION — Conversion de devise

**Entrée** : prix dans une devise X. **Sortie** : prix dans une devise Y.

**Formule** :

```
price_target_currency = price_source_currency / fx_rate(source → target)
```

Les taux sont saisis manuellement dans `simulations.market_params.fx_*` au format `<from>_<to>` (ex: `fx_rmb_eur = 7.95` signifie `1 EUR = 7.95 RMB`, donc `prix_eur = prix_rmb / 7.95`).

**Conventions de saisie des taux** : tous les taux sont exprimés **à partir de l'EUR**. L'utilisateur saisit dans la modale de paramètres marché :

- `fx_eur_rmb` = combien de RMB pour 1 EUR (ex: 7.95)
- `fx_eur_usd` = combien de USD pour 1 EUR (ex: 1.15)

Les taux entre devises non-EUR sont dérivés automatiquement par le moteur :

- `fx_rmb_usd` = `fx_eur_usd / fx_eur_rmb`
- `fx_usd_rmb` = `fx_eur_rmb / fx_eur_usd`
- Etc.

La fonction `context.get_fx_rate(from, to)` retourne le taux applicable selon la formule générale :

- Si `from = EUR` : retourne `fx_eur_<to>`
- Si `to = EUR` : retourne `1 / fx_eur_<from>`
- Sinon : retourne `fx_eur_<to> / fx_eur_<from>`

**Pseudo-code** :

```python
class CurrencyConversionModule(CalculationModule):
    def __init__(self, target_currency: str):
        self.target_currency = target_currency
    
    def apply(self, input_price: PriceWithCurrency, context: SimulationContext) -> CalculationStep:
        if input_price.currency == self.target_currency:
            return CalculationStep.passthrough(ModuleType.CURRENCY_CONVERSION, input_price)
        
        # context.get_fx_rate retourne le taux <from>→<to> avec dérivation automatique à partir des taux EUR
        rate = context.get_fx_rate(input_price.currency, self.target_currency)
        new_amount = input_price.amount * rate  # NB: rate est exprimé dans le sens from→to
        
        return CalculationStep(
            module_type=ModuleType.CURRENCY_CONVERSION,
            input_price=input_price,
            output_price=PriceWithCurrency(new_amount, self.target_currency),
            metadata={
                "from_currency": input_price.currency,
                "to_currency": self.target_currency,
                "fx_rate": rate,
            }
        )
```

⚠️ **Convention de calcul** : la fonction `get_fx_rate(from, to)` retourne un coefficient multiplicatif. Pour convertir 2836 RMB en EUR, elle retourne `1 / fx_eur_rmb = 1 / 7.95 ≈ 0.1258`. Le calcul est donc `2836 × 0.1258 = 356.7296 EUR`. Dans le pseudo-code des autres modules, lorsqu'on convertit un coût de transport vers la devise du prix d'entrée, la même fonction est utilisée (multiplication, pas division).

### 6.3.3 Module TRANSPORT — Coût logistique

**Entrée** : prix unitaire du SKU (en EUR généralement, après la conversion de devise).

**Sortie** : prix avec impact transport ajouté par unité.

**Deux modes de calcul** au choix de l'utilisateur :

**Mode 1 — Calcul détaillé** (par défaut)

```
coût_par_palette = coût_global_transport / nombre_palettes
coût_par_unité = coût_par_palette / quantité_par_palette_du_SKU

Si coût en devise différente du prix d'entrée :
    coût_par_unité = coût_par_unité / fx_rate(coût_currency → input_currency)

price_out = price_in + coût_par_unité
```

- `quantité_par_palette_du_SKU` est lu depuis `product.pallet_qty`. Si le SKU est exprimé en km (câbles), `pallet_qty` représente les km par palette (ex: 9 km/palette).
- `nombre_palettes` est pré-rempli depuis `transport_modes.default_pallet_capacity` mais modifiable par l'utilisateur.

**Mode 2 — Coefficient multiplicateur** (cas où le nombre de palettes n'est pas précisément connu, ex: conteneur mixte multi-produits)

```
price_out = price_in × coefficient
```

L'utilisateur saisit directement un coefficient (ex: 1.15 = +15% pour le transport). Si `override_coefficient` est renseigné dans la config du module, on utilise ce mode. Sinon, mode 1.

**Pseudo-code** :

```python
from typing import Optional

class TransportModule(CalculationModule):
    def __init__(
        self,
        transport_mode_code: str,
        global_cost: Decimal,
        currency: str,
        pallet_count: int,
        from_location: str,
        to_location: str,
        override_coefficient: Optional[Decimal] = None,
    ):
        self.transput_mode_code = transport_mode_code
        self.global_cost = global_cost
        self.currency = currency
        self.pallet_count = pallet_count
        self.from_location = from_location
        self.to_location = to_location
        self.override_coefficient = override_coefficient
    
    def apply(self, input_price: PriceWithCurrency, context: SimulationContext) -> CalculationStep:
        # Mode 2 : coefficient
        if self.override_coefficient is not None:
            new_amount = input_price.amount * self.override_coefficient
            return CalculationStep(
                module_type=ModuleType.TRANSPORT,
                input_price=input_price,
                output_price=PriceWithCurrency(new_amount, input_price.currency),
                metadata={
                    "mode": "coefficient",
                    "coefficient": self.override_coefficient,
                }
            )
        
        # Mode 1 : calcul détaillé
        product = context.product
        cost_per_pallet = self.global_cost / self.pallet_count
        cost_per_unit_in_transport_currency = cost_per_pallet / product.pallet_qty
        
        # Conversion vers la devise du prix d'entrée si nécessaire
        if self.currency != input_price.currency:
            fx = context.get_fx_rate(self.currency, input_price.currency)
            cost_per_unit = cost_per_unit_in_transport_currency * fx
        else:
            cost_per_unit = cost_per_unit_in_transport_currency
        
        new_amount = input_price.amount + cost_per_unit
        
        return CalculationStep(
            module_type=ModuleType.TRANSPORT,
            input_price=input_price,
            output_price=PriceWithCurrency(new_amount, input_price.currency),
            metadata={
                "mode": "detailed",
                "transport_mode": self.transport_mode_code,
                "global_cost": self.global_cost,
                "global_cost_currency": self.currency,
                "pallet_count": self.pallet_count,
                "cost_per_pallet": cost_per_pallet,
                "cost_per_unit": cost_per_unit,
                "from": self.from_location,
                "to": self.to_location,
            }
        )
```

### 6.3.4 Module CUSTOMS — Droits de douane

**Entrée** : prix unitaire.

**Logique MVP1** : coût global de douane saisi en amont (ex: pour un projet entier), réparti uniformément par unité.

**Formule** :

```
coût_douane_par_unité = coût_global_douane / quantité_totale_du_projet
price_out = price_in + coût_douane_par_unité
```

Pour les tarifs catalogue (pas de quantité définie), le module CUSTOMS peut être by-passé (`global_cost = 0`) ou exprimé comme un coefficient (`override_coefficient`).

**Pseudo-code** :

```python
class CustomsModule(CalculationModule):
    def __init__(
        self,
        global_cost: Decimal,
        currency: str,
        total_quantity: Optional[Decimal] = None,
        override_coefficient: Optional[Decimal] = None,
    ):
        self.global_cost = global_cost
        self.currency = currency
        self.total_quantity = total_quantity
        self.override_coefficient = override_coefficient
    
    def apply(self, input_price: PriceWithCurrency, context: SimulationContext) -> CalculationStep:
        if self.override_coefficient is not None:
            new_amount = input_price.amount * self.override_coefficient
            return CalculationStep(
                module_type=ModuleType.CUSTOMS,
                input_price=input_price,
                output_price=PriceWithCurrency(new_amount, input_price.currency),
                metadata={"mode": "coefficient", "coefficient": self.override_coefficient}
            )
        
        if self.global_cost == 0 or self.total_quantity is None:
            return CalculationStep.passthrough(ModuleType.CUSTOMS, input_price)
        
        cost_per_unit_in_customs_currency = self.global_cost / self.total_quantity
        
        if self.currency != input_price.currency:
            fx = context.get_fx_rate(self.currency, input_price.currency)
            cost_per_unit = cost_per_unit_in_customs_currency * fx
        else:
            cost_per_unit = cost_per_unit_in_customs_currency
        
        return CalculationStep(
            module_type=ModuleType.CUSTOMS,
            input_price=input_price,
            output_price=PriceWithCurrency(input_price.amount + cost_per_unit, input_price.currency),
            metadata={
                "mode": "detailed",
                "global_cost": self.global_cost,
                "global_cost_currency": self.currency,
                "total_quantity": self.total_quantity,
                "cost_per_unit": cost_per_unit,
            }
        )
```

### 6.3.5 Module MARGIN — Application de marge

**Entrée** : prix sans marge.

**Formule** :

```
price_out = price_in / (1 - margin_rate)
```

**Exemple** : si `margin_rate = 0.06`, `price_out = price_in / 0.94`.

La marge est exprimée en pourcentage du prix de vente final, pas du prix d'achat. C'est une marge sur prix de vente : pour 100 EUR achetés avec 6% de marge, on vend 100 / 0.94 = 106.38 EUR.

**Pseudo-code** :

```python
class MarginModule(CalculationModule):
    def __init__(self, margin_rate: Decimal, label: str):
        self.margin_rate = margin_rate  # 0.06 pour 6%
        self.label = label  # "symea" ou "syskern"
    
    def apply(self, input_price: PriceWithCurrency, context: SimulationContext) -> CalculationStep:
        if self.margin_rate >= 1 or self.margin_rate < 0:
            raise ValueError(f"Invalid margin rate: {self.margin_rate}")
        
        new_amount = input_price.amount / (Decimal(1) - self.margin_rate)
        
        return CalculationStep(
            module_type=ModuleType.MARGIN,
            input_price=input_price,
            output_price=PriceWithCurrency(new_amount, input_price.currency),
            metadata={
                "label": self.label,
                "rate": self.margin_rate,
                "margin_amount": new_amount - input_price.amount,
            }
        )
```

### 6.3.6 Surcharges par ligne (override par SKU)

Dans une simulation portant sur N SKU, l'utilisateur peut surcharger certains paramètres pour un SKU spécifique :

- `margin_override` : marge Syskern spécifique à ce SKU (override du taux global)
- `stock_purchase_mix_pct_override` : mix stock/achat spécifique à ce SKU

Ces surcharges sont stockées dans `simulation_lines` et appliquées au moment du calcul de la ligne.

Les surcharges par gamme ("appliquer X% de marge à toute la gamme Câbles Cat 7") sont disponibles via une UI de bulk-edit qui propage la valeur sur toutes les `simulation_lines` correspondant au filtre.

## 6.4 Chaîne complète PA — exemple chiffré validé

Cet exemple reproduit pas à pas le calcul validé avec Olivier lors du kickoff. Les tests unitaires du moteur doivent reprendre ces chiffres exactement, avec arithmétique décimale stricte.

### Données d'entrée

| Paramètre | Valeur | SKU | Câble data générique (cuivre-indexé) |
| --- | --- | --- | --- |
| Unité de base | km | Poids cuivre | 18 kg/km |
| `pallet_qty` | 9 km/palette | **Paramètres marché** |  |
| Cours cuivre base | 70 000 RMB/tonne | Cours cuivre actuel | 97 000 RMB/tonne |
| Taux RMB/EUR | 7.95 | Taux USD/EUR | 1.15 |
| **Fournisseur** |  | PO base | 2 350 RMB/km |
| Devise PO | RMB | Incoterm achat | FOB Shanghai |
| **Chaîne de transport** |  | Transport 1 | Maritime 40HQ Shanghai → Le Havre, 3 000 USD, 40 palettes |
| Transport 2 | Routier camion Le Havre → Réau, 1 000 EUR, 40 palettes | Douane | 0 (non applicable ici) |
| Marge Symea | 6% | **Position de la marge** | après les transports |

### Étape 1 — Variation cuivre

```
variation = (97 000 - 70 000) × 18 / 1000
variation = 27 000 × 0.018
variation = 486 RMB/km

PO net (RMB) = 2 350 + 486 = 2 836 RMB/km
```

### Étape 2 — Conversion en EUR

```
PO net (EUR) = 2 836 / 7.95 = 356.7296 €/km
```

### Étape 3 — Transport 1 (maritime, USD)

```
coût_par_palette (USD) = 3 000 / 40 = 75 USD/palette
coût_par_km (USD) = 75 / 9 = 8.3333 USD/km
coût_par_km (EUR) = 8.3333 / 1.15 = 7.2464 €/km

price_après_transport_1 = 356.7296 + 7.2464 = 363.9760 €/km
```

### Étape 4 — Transport 2 (routier, EUR)

```
coût_par_palette (EUR) = 1 000 / 40 = 25 EUR/palette
coût_par_km (EUR) = 25 / 9 = 2.7778 €/km

price_après_transport_2 = 363.9760 + 2.7778 = 366.7538 €/km
```

### Étape 5 — Douane

```
coût_douane = 0
price_après_douane = 366.7538 €/km
```

### Étape 6 — Marge Symea (6%)

```
PA net = 366.7538 / (1 - 0.06)
PA net = 366.7538 / 0.94
PA net = 390.1636 €/km
```

**Affichage UI** : 390.16 €/km (arrondi 2 décimales).

**Stockage BDD** : 390.1636 €/km (4 décimales).

### Stockage du calcul

Dans `simulation_lines.calculation_breakdown` :

```json
{
  "steps": [
    {
      "module": "copper_variation",
      "input_price": {"amount": 2350, "currency": "RMB"},
      "output_price": {"amount": 2836, "currency": "RMB"},
      "metadata": {
        "copper_base": 70000,
        "copper_current": 97000,
        "copper_weight_kg": 18,
        "variation": 486
      }
    },
    {
      "module": "currency_conversion",
      "input_price": {"amount": 2836, "currency": "RMB"},
      "output_price": {"amount": 356.7296, "currency": "EUR"},
      "metadata": {"fx_rate": 7.95}
    },
    {
      "module": "transport",
      "order": 1,
      "input_price": {"amount": 356.7296, "currency": "EUR"},
      "output_price": {"amount": 363.9760, "currency": "EUR"},
      "metadata": {
        "transport_mode": "40HQ",
        "global_cost": 3000,
        "global_cost_currency": "USD",
        "pallet_count": 40,
        "cost_per_unit": 7.2464
      }
    },
    {
      "module": "transport",
      "order": 2,
      "input_price": {"amount": 363.9760, "currency": "EUR"},
      "output_price": {"amount": 366.7538, "currency": "EUR"},
      "metadata": {
        "transport_mode": "TRUCK_FULL",
        "global_cost": 1000,
        "global_cost_currency": "EUR",
        "pallet_count": 40,
        "cost_per_unit": 2.7778
      }
    },
    {
      "module": "customs",
      "input_price": {"amount": 366.7538, "currency": "EUR"},
      "output_price": {"amount": 366.7538, "currency": "EUR"},
      "metadata": {"applied": false, "global_cost": 0}
    },
    {
      "module": "margin",
      "input_price": {"amount": 366.7538, "currency": "EUR"},
      "output_price": {"amount": 390.1636, "currency": "EUR"},
      "metadata": {"label": "symea", "rate": 0.06}
    }
  ],
  "final_pa_net_eur": 390.1636
}
```

Ce détail complet est obligatoire : il sert de traçabilité et permet à l'utilisateur de comprendre exactement comment le PA a été calculé.

## 6.5 Précision numérique et arrondis

📌 **Décision archi** : tous les calculs internes sont effectués en `Decimal` Python (et non en `float`) pour éviter les erreurs d'arrondi flottant.

**Règles d'arrondi** :

- **Aucun arrondi intermédiaire** entre les modules. Chaque module reçoit le `Decimal` complet du module précédent.
- **Arrondi à l'affichage uniquement** : 4 décimales en stockage BDD (`NUMERIC(12,4)`), 2 décimales à l'affichage UI (sauf pour les taux : 4 décimales).
- **Méthode d'arrondi** : `ROUND_HALF_UP` (arrondi commercial standard).

**Côté frontend** : utiliser `Intl.NumberFormat` avec la locale appropriée (`fr-FR`, `en-US`, `es-ES`) selon la préférence linguistique de l'utilisateur.

## 6.6 Validation et garde-fous

Le moteur refuse de calculer (ou affiche un warning explicite) dans les cas suivants :

| Condition | Action |
| --- | --- |
| `fx_rate <= 0` ou taux manquant pour une conversion requise | Erreur bloquante |
| `transport.pallet_count <= 0` | Erreur bloquante |
| `margin_rate >= 1` ou `margin_rate < 0` | Erreur bloquante (division impossible ou marge négative) |
| Aucun fournisseur actif sur le SKU | Erreur bloquante : SKU non simulable, exclu de la simulation |

En cas de warning sur un SKU, la simulation continue pour les autres SKU. La ligne en warning est marquée dans `simulation_lines` avec un statut visible dans l'UI.

## 6.7 Chaîne PR — Prix de revient et mix stock/achat

Le **Prix de Revient (PR)** est le prix qui sert de base au calcul du PV. Il résulte de la combinaison de deux composantes :

- le **PA net** calculé dans la chaîne PA (§6.4)
- le **PAMP prévisionnel** calculé à partir des stocks Odoo et des achats engagés

Le ratio entre les deux est défini par le **mix stock/achat**, exprimé en pourcentage.

### 6.7.1 Calcul du PAMP prévisionnel

Le **PAMP** (Prix d'Achat Moyen Pondéré) est calculé par Odoo et reflète le coût moyen pondéré des unités en stock. Il est synchronisé dans `products.pamp_eur`.

Le **PAMP prévisionnel** est calculé par la plateforme : c'est le PAMP projeté dans le futur en simulant les achats engagés (commandes en cours de réception) et les ventes engagées (commandes à livrer). Il répond à la question : "si toutes les commandes en cours étaient réalisées, quel serait le PAMP à ce moment-là ?"

**Formule** :

```
Valeur stock actuel  = stock_quantity × pamp_eur
Valeur achats engagés = Σ (qty_purchase_i × price_unit_purchase_i)
Valeur ventes engagées = Σ (qty_sale_j × pamp_eur_at_sale)
     [→ les ventes consomment du stock au PAMP courant, ne modifient pas le PAMP futur]

Quantité finale projetée = stock_quantity + Σ qty_purchase_i - Σ qty_sale_j

PAMP prévisionnel = (Valeur stock actuel + Valeur achats engagés) / (stock_quantity + Σ qty_purchase_i)
```

**Pseudo-code** :

```python
from decimal import Decimal

async def compute_predictive_pamp(
    product: Product,
    odoo: OdooAdapter,
) -> Decimal:
    """Calcule le PAMP prévisionnel à partir du stock courant + achats engagés.
    Les ventes engagées consomment le stock au PAMP courant et n'impactent
    pas le PAMP prévisionnel (le PAMP est un prix moyen pondéré d'entrées).
    """
    if product.odoo_id is None:
        # Produit créé localement, jamais syncé → pas de PAMP prévisionnel
        return Decimal(0)
    
    pending_purchases = await odoo.get_pending_purchases([product.odoo_id])
    purchases = pending_purchases.get(product.odoo_id, [])
    
    stock_qty = product.stock_quantity or Decimal(0)
    pamp = product.pamp_eur or Decimal(0)
    
    stock_value = stock_qty * pamp
    purchase_value = sum(
        Decimal(p["quantity"]) * Decimal(p["price_unit"]) 
        for p in purchases
    )
    purchase_qty = sum(Decimal(p["quantity"]) for p in purchases)
    
    total_qty = stock_qty + purchase_qty
    if total_qty == 0:
        return Decimal(0)
    
    return (stock_value + purchase_value) / total_qty
```

**Cas particuliers** :

- **Produit non syncé avec Odoo** (`odoo_id IS NULL`) : `pamp_predictive_eur = NULL`. Le mix stock/achat ne peut s'appliquer que sur la composante PA. La simulation force `mix_pct = 0` pour ce SKU.
- **Stock = 0 et aucun achat engagé** : `pamp_predictive_eur = NULL`. Même comportement.
- **Stock = 0 mais achats engagés présents** : `pamp_predictive_eur = sum(qty × price) / sum(qty)` (PAMP des seuls achats).
- **Achats engagés avec prix d'achat en devise non-EUR** : conversion en EUR via les taux saisis dans `simulations.market_params`. Le PAMP prévisionnel est toujours stocké en EUR.

### 6.7.2 Formule du mix stock/achat

**Formule** :

```
mix_ratio = mix_pct / 100  (0 ≤ mix_pct ≤ 100)

PR = mix_ratio × PAMP_prévisionnel + (1 - mix_ratio) × PA_net
```

Où :

- `mix_pct = 0` → PR = PA_net (calcul 100% sur nouveau prix d'achat)
- `mix_pct = 100` → PR = PAMP prévisionnel (calcul 100% sur stock + achats engagés)
- `mix_pct = 50` → PR = moyenne des deux

**Pseudo-code** :

```python
def compute_pr(
    pa_net_eur: Decimal,
    pamp_predictive_eur: Optional[Decimal],
    mix_pct: int,
) -> Decimal:
    if mix_pct < 0 or mix_pct > 100:
        raise ValueError(f"mix_pct must be 0-100, got {mix_pct}")
    
    # Cas où le PAMP prévisionnel n'est pas calculable
    if pamp_predictive_eur is None:
        if mix_pct > 0:
            # On force le mix à 0% et on log un warning
            return pa_net_eur
        return pa_net_eur
    
    mix_ratio = Decimal(mix_pct) / Decimal(100)
    return (mix_ratio * pamp_predictive_eur) + ((Decimal(1) - mix_ratio) * pa_net_eur)
```

### 6.7.3 Mix par défaut et surcharges

**Mix global de simulation** : défini dans `simulations.stock_purchase_mix_pct`. S'applique à toutes les lignes de la simulation par défaut.

**Surcharge par ligne** : chaque `simulation_line` peut définir un `stock_purchase_mix_pct_override` qui prend le pas sur le mix global pour cette ligne uniquement.

**Surcharge par gamme** (bulk-edit) : l'UI propose une fonction "Appliquer un mix de X% à toute la gamme Y". Cette action propage la valeur sur toutes les `simulation_lines` correspondant au filtre sélectionné. Les surcharges par ligne précédentes sont écrasées uniquement pour les lignes du filtre.

**Règle de résolution** :

```python
def resolve_mix_pct(simulation: Simulation, line: SimulationLine) -> int:
    if line.stock_purchase_mix_pct_override is not None:
        return line.stock_purchase_mix_pct_override
    return simulation.stock_purchase_mix_pct
```

## 6.8 Chaîne PV — Prix de vente

La chaîne PV reprend la même architecture modulaire que la chaîne PA, côté vente. Elle démarre du PR et applique les modules configurés pour produire le PV final dans la devise et l'incoterm de vente.

```
[PR] → [bloc DnD côté vente] = PV final
```

Le bloc DnD côté vente contient :

- N modules `TRANSPORT` (transport de revente, livraison client) — souvent vide pour des ventes EXW ou FCA
- 0 ou 1 module `CUSTOMS` (droits d'export ou droits du pays destinataire selon incoterm)
- Exactement 1 module `MARGIN(Syskern)` — obligatoire, position libre dans la chaîne

### 6.8.1 Marge Syskern — taux par défaut et surcharges

La marge Syskern par défaut est de **20%**. Cette valeur est stockée dans `simulations.syskern_margin_rate`.

**Surcharge par ligne** : chaque `simulation_line` peut définir un `margin_override` qui prend le pas sur le taux global pour cette ligne. Cas d'usage : produit à forte concurrence sur lequel on accepte une marge réduite à 12%, ou produit premium où on pousse la marge à 28%.

**Surcharge par gamme** (bulk-edit) : même mécanisme que pour le mix. "Appliquer 25% de marge à toute la gamme Câbles Cat 7".

**Surcharge par segment client** : pas de mécanisme automatique en MVP1. Si un client a un segment particulier (ex: "Premium"), l'utilisateur saisit manuellement la marge correspondante au moment de la simulation.

**Règle de résolution** :

```python
def resolve_margin_rate(simulation: Simulation, line: SimulationLine) -> Decimal:
    if line.margin_override is not None:
        return line.margin_override
    return simulation.syskern_margin_rate
```

### 6.8.2 Devise de vente et conversion finale

La devise du PV est définie au niveau de la simulation (`simulations` : pas de champ dédié côté simulation, c'est l'**offre** qui porte la devise de vente — voir `offers.currency`).

Dans le cycle de calcul :

1. Le PR est calculé en EUR (devise pivot interne)
2. La chaîne PV applique les modules en EUR
3. Le PV final est converti dans la devise de vente au moment de la génération de l'offre (pas au moment de la simulation)

Cela permet à une même simulation d'alimenter plusieurs offres dans des devises différentes sans recalcul.

### 6.8.3 Incoterm et cohérence transports côté vente

L'incoterm de vente est saisi au niveau de l'offre (`offers.incoterm`). L'UI de la simulation rappelle l'incoterm côté vente sélectionné et vérifie la cohérence avec les modules de transport ajoutés :

- Incoterm EXW → aucun transport côté vente attendu (warning si présent)
- Incoterm FCA, FOB → pas de transport principal côté vente (warning si présent)
- Incoterm CIF, CFR, CIP → transport principal attendu (warning si absent)
- Incoterm DAP, DPU, DDP → transport jusqu'à destination + douane attendus selon le cas

Les warnings sont **non bloquants** : l'utilisateur peut générer la simulation même en cas d'incohérence apparente, car certains cas business peuvent justifier l'écart.

### 6.8.4 Exemple de chaîne PV simple

Reprise de l'exemple §6.4 (PA net = 390.1636 €/km), avec :

- Mix stock/achat = 0% (calcul sur PA pur, pas de stock disponible)
- PR = PA net = 390.1636 €/km
- Chaîne PV : marge Syskern 20% uniquement (vente EXW, pas de transport ajouté)

```
PV = 390.1636 / (1 - 0.20)
PV = 390.1636 / 0.80
PV = 487.7045 €/km
```

**Affichage UI** : 487.70 €/km.

## 6.9 Simulations — cycle de vie et UI

### 6.9.1 Cycle de vie d'une simulation

Une simulation passe par les états suivants :

| Statut | Description | Actions possibles |
| --- | --- | --- |
| `finalized` | Simulation figée. Les paramètres et résultats ne peuvent plus être modifiés. Sert de base pour générer une ou plusieurs offres. | Consulter, dupliquer (crée une nouvelle simulation `draft`), générer une offre |

Le passage de `draft` à `finalized` se fait via un bouton explicite dans l'UI avec confirmation. Pas de rétroaction possible : pour modifier une simulation finalisée, il faut la dupliquer.

### 6.9.2 Création d'une simulation

Page `/simulator/new`. Wizard en 3 étapes :

**Étape 1 — Type et contexte**

- Type : Tarif (multi-clients) ou Projet (1 client + nom de projet)
- Label de la simulation (pour la retrouver)
- Si Projet : nom du projet, infos contexte libre

**Étape 2 — Sélection des SKU**

Trois méthodes au choix, combinables :

- **Depuis le catalogue** : redirect vers le catalogue avec mode "sélection multiple". L'utilisateur filtre, coche les SKU, clique "Ajouter à la simulation".
- **Par filtre de gamme** : sélection en cascade (univers → famille → gamme → sous-gamme). Tous les SKU correspondant au filtre sont ajoutés.
- **Par fichier import** : upload d'un Excel/CSV avec une colonne `sku_code`. Les SKU non trouvés en BDD sont listés en erreur dans un panneau latéral. L'utilisateur peut choisir de les ignorer ou de créer les produits manquants.

**Étape 3 — Paramètres marché et chaîne de calcul**

- Modale paramètres marché : cours cuivre base, cours cuivre actuel, taux EUR→RMB, taux EUR→USD
- Construction de la chaîne PA (drag-and-drop des modules)
- Construction de la chaîne PV (drag-and-drop des modules)
- Mix stock/achat global
- Marges Symea et Syskern par défaut

À la fin du wizard : la simulation est créée en `draft`, l'utilisateur arrive sur la vue principale `/simulator/[id]`.

### 6.9.3 Vue principale d'une simulation (`/simulator/[id]`)

Layout en 3 zones :

```
┌──────────────────────────────────────────────────────────────────────┐
│ Simulation : Tarif Q3 2026 export   [draft]   [Finaliser] [Dupliquer]  │
├──────────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────┐ ┌─────────────────────────────────────────┐ │
│ │ Paramètres        │ │ Tableau de résultats par SKU              │ │
│ │                  │ │                                            │ │
│ │ Marché            │ │ SKU | Nom | PA | PR | PV | Marge | Mix... │ │
│ │ ├ Cuivre base 70k │ │ ...                                        │ │
│ │ ├ Cuivre act 97k  │ │ ...                                        │ │
│ │ ├ FX EUR→RMB 7.95 │ │                                            │ │
│ │ └ FX EUR→USD 1.15 │ │                                            │ │
│ │                  │ │                                            │ │
│ │ Chaîne PA  […]    │ │                                            │ │
│ │ ≡ Transport mar  │ │                                            │ │
│ │ ≡ Transport rou  │ │                                            │ │
│ │ ≡ Douane         │ │                                            │ │
│ │ ≡ Marge Symea 6% │ │                                            │ │
│ │                  │ │                                            │ │
│ │ Chaîne PV  […]    │ │ [Bulk edit]  [Recalculer tout]            │ │
│ │ ≡ Marge Syskern  │ │                                            │ │
│ │   20%            │ │                                            │ │
│ │                  │ │                                            │ │
│ │ Mix global 0%    │ │                                            │ │
│ └─────────────────────┘ └─────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

**Sidebar gauche (paramètres)** :

- Section pliable "Marché" : cours cuivre base/actuel + taux FX EUR→RMB, EUR→USD. Bouton "Modifier" ouvre la modale de saisie des paramètres marché.
- Section "Chaîne PA" : liste verticale draggable des modules. Chaque module est une carte avec icone, label, principaux paramètres, bouton "⋮" (éditer / dupliquer / supprimer). Boutons "+ Transport" et "+ Douane" en bas.
- Section "Chaîne PV" : même structure que la chaîne PA.
- Section "Paramètres globaux" : mix stock/achat global, marges par défaut.

**Zone centrale (tableau de résultats)** :

- Bandeau de contexte de calcul en haut (cf. §6.9.4) : date du dernier calcul, cours cuivre utilisé, taux FX utilisés, snapshot Odoo utilisé
- Bouton « Recalculer » proeminent dans le bandeau
- Une ligne par SKU
- Colonnes par défaut : SKU, Nom, Gamme, Stock, PAMP, PA net, PAMP prévisionnel, PR, PV, Marge effective (calculée), Mix effectif, Statut
- Colonnes configurables (afficher/masquer)
- Tri par n'importe quelle colonne
- Cellules éditables pour les surcharges (`margin_override`, `stock_purchase_mix_pct_override`) — marquent la ligne dirty
- Lignes en warning surlignées en jaune (cf. §6.6)
- Lignes en erreur surlignées en rouge avec icône d'alerte
- Lignes dirty (surcharge modifiée mais pas recalculée) : badge « modifié » sur la ligne avec menu contextuel « Recalculer cette ligne »
- Boutons en bas : "Bulk edit" (ouvre modale de surcharge par filtre), "Exporter Excel"

**En-tête** :

- Label de la simulation, statut (badge coloré), boutons d'action

### 6.9.4 Recalcul — déclenchement uniquement manuel

📌 **Décision archi structurante** : aucun recalcul automatique. Le recalcul d'une simulation s'effectue uniquement quand l'utilisateur clique sur le bouton **« Recalculer »**. Cette décision répond à deux exigences :

- Traçabilité : un résultat de simulation est toujours associé à un horodatage et à un jeu de paramètres marché explicites
- Contrôle : l'utilisateur décide quand intégrer un nouveau cours du cuivre ou un nouveau snapshot Odoo

#### État « dirty » (paramètres modifiés, résultats non rafraîchis)

Toute modification d'un paramètre influençant le calcul (paramètres marché, chaîne PA, chaîne PV, mix global, marges globales, ajout/suppression/réordonnancement de modules, surcharges par ligne, bulk-edit) marque la simulation comme **dirty**.

**Persistance** : la modification est sauvegardée en base immédiatement (autosave avec debounce 1s sur les saisies). Les résultats des `simulation_lines` ne sont **pas** recalculés.

**Matérialisation UI de l'état dirty** :

- Badge « Paramètres modifiés » visible en haut de la simulation
- Bouton « Recalculer » passe en état proeminent (couleur primaire, légère animation pulse)
- Tableau de résultats grisaille état dirty (opacité réduite + bandeau « Résultats non à jour avec les paramètres actuels »)
- Tooltip sur les colonnes calculées : « Calculé le {date} avec cuivre {valeur} et FX {valeurs} »

#### Bandeau de contexte de calcul

En haut du tableau de résultats, un bandeau permanent affiche le contexte du dernier recalcul :

```
┌─────────────────────────────────────────────────────────────────────┐
│ 🕒 Calculé le 28/04/2026 à 14:32  —  Cuivre : 97 000 RMB/t      │
│    FX : 1 EUR = 7.95 RMB / 1.15 USD                                  │
│    Snapshot Odoo : 28/04/2026 03:00                                  │
│                                                          [Recalculer]│
└─────────────────────────────────────────────────────────────────────┘
```

Si l'état est dirty, le bandeau ajoute une mention explicite :

```
⚠️ Paramètres modifiés depuis ce calcul. Cliquez sur « Recalculer » pour rafraîchir.
```

#### Comportement du bouton « Recalculer »

Au clic, modale de confirmation qui propose 3 options de recalcul :

1. **Recalculer avec les paramètres actuels uniquement** : utilise les paramètres marché et snapshots Odoo actuellement saisis dans la simulation. Pas de fetch externe.
2. **Rafraîchir les données Odoo puis recalculer** : pull du stock, PAMP et achats engagés depuis Odoo pour tous les SKU de la simulation, puis recalcul. Met à jour les `product_snapshot` et `supplier_snapshot` des `simulation_lines`.
3. **Recalcul complet (données Odoo + saisie cuivre/FX)** : ouvre la modale paramètres marché pour saisir de nouveaux cours, puis pull Odoo, puis recalcul.

À l'issue du recalcul :

- Le timestamp `last_calculated_at` de la simulation est mis à jour
- Les `market_params` au moment du calcul sont snapshotés et figés dans `simulations.market_params`
- L'état dirty est levé
- Les résultats des `simulation_lines` sont remplacés

#### Cas particulier — saisie de surcharges sur les lignes

Lors de l'édition d'une cellule de surcharge dans le tableau (`margin_override`, `stock_purchase_mix_pct_override`), le système ne recalcule pas la ligne automatiquement. Le badge dirty apparaît sur la ligne concernée (et au niveau global de la simulation).

Une action **« Recalculer cette ligne uniquement »** est disponible dans le menu contextuel de chaque ligne (clic-droit ou bouton « ⋮ »), permettant un recalcul granulaire sans rafraîchir toute la simulation.

### 6.9.5 Bulk-edit (surcharges par filtre)

Modale déclenchée par le bouton "Bulk edit" :

1. **Définition du filtre** : critères cumulables sur gamme, marque, fournisseur, attributs dynamiques
2. **Aperçu du nombre de lignes impactées** affiché en temps réel
3. **Action à appliquer** : choix entre
    - Définir une marge spécifique (ex: 25%)
    - Définir un mix stock/achat spécifique (ex: 50%)
    - Réinitialiser les surcharges (revenir aux valeurs globales)
4. **Confirmation** : application sur les lignes filtrées

Les lignes ainsi modifiées portent un indicateur visuel "surchargé" dans le tableau.

### 6.9.6 Persistance et rechargement

**Sauvegarde automatique** : toute modification de structure ou de paramètre est persistée en base au fil de l'eau (debounce 1s sur les saisies). L'utilisateur peut fermer son navigateur à tout moment et reprendre exactement où il s'est arrêté. La sauvegarde inclut l'état dirty : si la simulation était dirty avant fermeture, elle est ré-ouverte dirty.

**Rechargement** : à l'ouverture d'une simulation existante, le moteur :

1. Charge la simulation et ses lignes depuis la BDD
2. Affiche les résultats figés tels qu'ils ont été calculés lors du dernier `last_calculated_at`
3. Affiche le bandeau de contexte de calcul (cf. §6.9.4) avec les paramètres marché et la date du dernier recalcul
4. Si la simulation est dirty, affiche le bandeau d'avertissement et met le bouton « Recalculer » en évidence

**Aucun recalcul automatique à l'ouverture.** Les résultats affichés sont toujours ceux du dernier recalcul explicite. Si l'utilisateur souhaite intégrer un nouveau cours du cuivre ou un nouveau snapshot Odoo, il utilise le bouton « Recalculer ».

### 6.9.7 Duplication

Depuis la vue d'une simulation (draft ou finalized), bouton "Dupliquer" :

- Crée une nouvelle simulation `draft`
- Copie intégrale : type, label (suffixe " (copie)"), client_ids, paramètres marché, chaîne de calcul, mix, marges
- Copie intégrale des `simulation_lines` avec leurs surcharges et leurs derniers résultats calculés
- Pas de copie des offres associées à l'original
- La simulation dupliquée hérite du `last_calculated_at` et des résultats figés de l'original (pas de recalcul automatique)

### 6.9.8 Comparaison de simulations (what-if)

Écran dédié `/simulator/compare` :

- L'utilisateur sélectionne 2 à 4 simulations
- Tableau comparatif avec une colonne par simulation
- Lignes : SKU communs aux simulations sélectionnées
- Mise en évidence des écarts de PV (delta absolu et %)

Ce mode permet de comparer rapidement plusieurs scénarios (ex: marge 20% vs 25%, mix 0% vs 50%) sans dupliquer manuellement les paramètres.

### 6.9.9 Endpoints API internes

```
GET    /api/simulations                       # Liste des simulations
GET    /api/simulations/{id}                  # Détail simulation + lignes
POST   /api/simulations                       # Création
PATCH  /api/simulations/{id}                  # Mise à jour partielle
DELETE /api/simulations/{id}                  # Suppression (uniquement si draft)
POST   /api/simulations/{id}/finalize         # Passage à finalized
POST   /api/simulations/{id}/duplicate        # Duplication

POST   /api/simulations/{id}/lines            # Ajout de SKU à la simulation
PATCH  /api/simulations/{id}/lines/{line_id}  # Surcharge sur une ligne
DELETE /api/simulations/{id}/lines/{line_id}  # Retrait d'un SKU
POST   /api/simulations/{id}/lines/bulk       # Bulk edit (body: filtre + action)

POST   /api/simulations/{id}/recalculate      # Force le recalcul complet
POST   /api/simulations/{id}/refresh-data     # Rafraîchit market_params + snapshots Odoo puis recalcule
GET    /api/simulations/{id}/export           # Export Excel des résultats

POST   /api/simulations/compare               # Body : array d'IDs de simulations à comparer
```

### 6.9.10 Règles d'intégrité

- Une simulation `finalized` ne peut plus être modifiée via l'API. Toute requête `PATCH` ou modification de ligne retourne `403 Forbidden`. Le bouton « Recalculer » est également désactivé.
- La suppression d'une simulation est interdite si **au moins une offre y est attachée**. L'API retourne `409 Conflict` avec la liste des offres associées. L'utilisateur doit d'abord supprimer les offres ou archiver la simulation (cf. §6.9.11).
- La suppression d'une simulation `finalized` est interdite même sans offre attachée (statut conservé pour archivage). Seules les simulations `draft` sans offre peuvent être supprimées.
- La suppression d'un produit (soft delete) n'affecte pas les simulations existantes (les snapshots sont autonomes).
- La modification d'un produit (descriptions, hiérarchie, etc.) n'affecte pas les simulations existantes (les snapshots sont figés jusqu'au prochain recalcul manuel).
- La modification d'un attribut du registre n'affecte pas les simulations existantes.

### 6.9.11 Archivage d'une simulation

Pour les simulations `finalized` qui ne sont plus pertinentes mais qu'on ne peut/veut pas supprimer (offres attachées ou traçabilité historique), un statut supplémentaire `archived` est disponible :

- Disponible uniquement sur les simulations `finalized`
- Bouton « Archiver » dans la vue détaillée
- Une simulation archivée n'apparaît plus dans la liste par défaut (filtre actif « Non archivées »)
- Les offres associées restent intactes
- L'archivage est réversible : bouton « Désarchiver » pour la remettre dans la liste active

### 6.9.12 Historique des recalculs

📌 **Décision archi** : chaque recalcul d'une simulation crée une trace figée dans une table dédiée `simulation_recalculations`. Cette trace permet à l'utilisateur de consulter l'historique des calculs antérieurs d'une simulation : quel cours du cuivre, quels taux FX, quel snapshot Odoo, et quels résultats agrégés.

#### Table `simulation_recalculations`

```sql
CREATE TABLE simulation_recalculations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    simulation_id UUID NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Snapshot des paramètres marché utilisés pour ce calcul
    market_params JSONB NOT NULL,
    /* Structure identique à simulations.market_params :
    {
      "copper_base_price_rmb": 70000,
      "copper_current_price_rmb": 97000,
      "fx_eur_rmb": 7.95,
      "fx_eur_usd": 1.15
    }
    */
    
    -- Snapshot Odoo de référence (timestamp du dernier sync utilisé)
    odoo_snapshot_at TIMESTAMPTZ,
    
    -- Chaîne de calcul utilisée (snapshot complet)
    calculation_chain JSONB NOT NULL,
    
    -- Paramètres globaux utilisés
    stock_purchase_mix_pct INTEGER NOT NULL,
    syskern_margin_rate NUMERIC(5,4) NOT NULL,
    symea_margin_rate NUMERIC(5,4) NOT NULL,
    
    -- Résultats agrégés pour affichage rapide dans l'historique
    aggregates JSONB NOT NULL,
    /* Structure :
    {
      "line_count": 42,
      "avg_pa_eur": 320.50,
      "avg_pr_eur": 320.50,
      "avg_pv_eur": 400.62,
      "avg_margin_pct": 20.0,
      "min_pv_eur": 12.30,
      "max_pv_eur": 1830.45,
      "warnings_count": 2,
      "errors_count": 0
    }
    */
    
    -- Type de recalcul déclenché
    trigger_type TEXT NOT NULL,  -- 'manual_current_params' | 'manual_refresh_odoo' | 'manual_full_refresh' | 'line_recalculate'
    
    -- Optionnel : note libre saisie par l'utilisateur lors du recalcul
    note TEXT,
    
    INDEX idx_recalc_simulation_date (simulation_id, calculated_at DESC)
);
```

#### Création d'une trace

À chaque recalcul complet d'une simulation (via le bouton « Recalculer » avec l'une des 3 options de scope), une nouvelle ligne est insérée dans `simulation_recalculations`.

**Cas exclus** :

- Recalcul d'une seule ligne (`/lines/{line_id}/recalculate`) ne génère pas de trace globale (juste un log applicatif)
- Le recalcul à la création initiale d'une simulation génère la première trace

#### Consultation depuis l'UI

Dans la vue principale d'une simulation, un bouton « Historique des recalculs » ouvre un panneau latéral droit affichant la liste chronologique des traces :

```
┌──────────────────────────────────────────┐
│ Historique des recalculs                           │
├──────────────────────────────────────────┤
│ ● 28/04/2026 14:32   [Actuel]                       │
│   Cuivre 97 000 RMB/t · EUR/RMB 7.95                │
│   42 lignes · PV moyen 400.62 € · Marge moy. 20.0%  │
│   Refresh complet Odoo                             │
│                                                    │
│ ● 25/04/2026 09:15                                   │
│   Cuivre 95 500 RMB/t · EUR/RMB 8.02                │
│   42 lignes · PV moyen 395.10 € · Marge moy. 20.0%  │
│   Paramètres actuels uniquement                    │
│   [Voir détail]  [Comparer avec actuel]            │
│                                                    │
│ ● 22/04/2026 11:00   [Création]                      │
│   Cuivre 94 000 RMB/t · EUR/RMB 8.10                │
│   42 lignes · PV moyen 388.40 € · Marge moy. 20.0%  │
│                                                    │
└──────────────────────────────────────────┘
```

Chaque trace affiche les métadonnées essentielles (date, cours cuivre, FX, agrégats) et propose deux actions :

- **Voir détail** : ouvre une modale avec le détail complet de la trace (chaîne de calcul, paramètres, agrégats)
- **Comparer avec actuel** : ouvre l'écran de comparaison §6.9.8 avec la trace sélectionnée versus la simulation actuelle

#### Rétention des traces

Les traces sont conservées indéfiniment tant que la simulation existe. À la suppression d'une simulation, les traces associées sont supprimées en cascade (`ON DELETE CASCADE`).

Aucune action de purge ou de nettoyage automatique n'est prévue en MVP1.

#### Endpoints API

```
GET    /api/simulations/{id}/recalculations              # Liste des traces (paginée, ordre décroissant par date)
GET    /api/simulations/{id}/recalculations/{recalc_id}  # Détail d'une trace
```

---

# 7. Brique 4 — Génération d'offres

## 7.1 Vue d'ensemble

La plateforme génère deux types d'offres distincts, qui répondent à des cas d'usage différents et ont des structures différentes :

**Offre tarifaire** — communication de prix à un ou plusieurs clients pour un catalogue de produits, avec une période de validité. Pas de notion de quantité commandée. Sortie : Excel avec champs configurables, ou catalogue tarifé léger.

**Offre projet** — réponse à une affaire spécifique pour un client unique, avec un nom de projet, des quantités, un argumentaire commercial et un package de documents joints (CGV, garantie, références projets, quality management). Sortie : devis Gamma structuré ou Excel.

Les deux types partagent le même point de départ technique : une simulation `finalized` du moteur de calcul (cf. §6.9). On ne génère jamais une offre sans simulation source.

## 7.2 Offre tarifaire

### 7.2.1 Création

Une offre tarifaire se crée depuis une simulation finalisée via un bouton « Créer une offre tarifaire ». La simulation source est figée : ses lignes (avec PV calculés) deviennent les lignes de l'offre.

### 7.2.2 Configuration

L'utilisateur configure les champs suivants :

- **Clients** : sélection multiple parmi les clients (Odoo + prospects locaux). Une même offre tarifaire peut concerner plusieurs clients simultanément.
- **Date début / date fin de validité** : période de validité de la grille tarifaire.
- **Base cuivre et base monnaie** : référentiel utilisé pour le calcul (récupéré depuis la simulation, affiché en lecture seule pour traçabilité).
- **Sélection produits** : reprise des produits de la simulation, avec possibilité de filtrer/désélectionner.
- **Incoterm** : incoterm de vente.
- **Devise** : devise d'affichage des prix (EUR ou USD).
- **Modèle d'export** : Excel avec champs configurables, ou catalogue tarifé.
- **Langue** : FR / EN / ES.
- **Instructions IA libres** : prompt libre saisi par l'utilisateur pour orienter la génération de copy par l'IA (introduction, mise en valeur, tonalité). Pas de logique de segmentation automatique.
- **Justification prix** : prompt libre pour générer un argumentaire tarifaire intégré au document.
- **Documents joints personnalisés** : fichiers ad-hoc uploadés au moment de la création (pas la bibliothèque fixe, qui est réservée aux offres projet).

### 7.2.3 Format Excel avec champs configurables

L'utilisateur choisit les colonnes à inclure dans l'Excel parmi une liste configurable :

- Code SKU
- Désignation
- Description marketing
- Description technique
- Prix unitaire (devise de l'offre)
- Devise
- Incoterm
- Famille / Gamme / Sous-gamme
- Marque
- Conditionnement (palette, carton)
- Poids unitaire
- HS Code
- GTIN
- Nom du client (utile pour import Odoo)
- Champs custom (issus du registre d'attributs)

L'ordre des colonnes est définissable par drag-and-drop. Le mapping client est utile lorsqu'Olivier ou Paul réimportent ensuite la grille dans Odoo : ils peuvent générer un Excel avec le nom du client par ligne pour faciliter l'import.

### 7.2.4 Format catalogue tarifé (MVP1 sans visuels)

Format "ultra basique" en MVP1 : référence SKU + désignation + prix, structuré par hiérarchie produit (Univers → Famille → Gamme).

Les visuels produits sont prévus en MVP2 (les assets ne sont pas gérés en MVP1, cf. §11). Le catalogue tarifé MVP1 est donc un document texte structuré, sans image, généré soit en PDF via Gamma soit en Excel.

### 7.2.5 Conversion devise au moment de la génération

Les prix calculés en EUR (devise pivot interne, cf. §6.8) sont convertis dans la devise cible de l'offre (EUR ou USD) au moment de la génération, en utilisant les taux de change figés dans `simulations.market_params`.

Le taux utilisé est tracé dans le document généré (mention en pied de page : « Taux de conversion appliqué : 1 EUR = 1.15 USD »).

## 7.3 Offre projet

### 7.3.1 Création

Une offre projet se crée depuis une simulation finalisée via un bouton « Créer une offre projet ». Contrairement à une offre tarifaire, elle est nominative et liée à un projet identifié.

### 7.3.2 Configuration

- **Client** : un seul client (parmi clients Odoo ou prospects locaux). Pas de multi-client pour une offre projet.
- **Infos client** : nom, contact, adresse — récupérés automatiquement depuis le client sélectionné.
- **Nom du projet** : champ texte obligatoire (ex: « Datacenter Marseille — Phase 1 »). Olivier l'a explicitement signalé comme champ manquant aujourd'hui.
- **Infos projet** : description libre, objectifs, contraintes — utilisés comme contexte pour la génération IA.
- **Validité** : durée en jours (ex: 30 jours), pas de date début/fin contrairement au tarif.
- **Base cuivre et monnaie** : récupérées depuis la simulation, affichées en lecture seule.
- **Sélection produits** : reprise des produits de la simulation, avec possibilité d'ajuster les quantités projet.
- **Incoterm** : incoterm de vente.
- **Devise** : devise d'affichage (EUR ou USD).
- **Langue** : FR / EN / ES — sélectionnable au moment de la génération, affecte aussi la langue du document Gamma.
- **Modèle d'export** : devis Gamma (par défaut) ou Excel.
- **Instructions IA libres** : prompt libre saisi par l'utilisateur pour orienter la génération de l'argumentaire commercial.
- **Justification prix** : prompt libre pour générer un argumentaire spécifique au projet.
- **Package de documents joints** : sélection multiple depuis la bibliothèque de documents fixes (cf. §7.4).
- **Documents joints personnalisés** : fichiers ad-hoc uploadés en complément de la bibliothèque.

### 7.3.3 Quantités projet

Dans une offre projet (à la différence d'une offre tarifaire), chaque ligne porte une **quantité** (`offer_lines.quantity`). L'utilisateur saisit les quantités prévues pour le projet. Cela permet de calculer un total projet.

Le prix de chaque ligne part par défaut du PV calculé dans la simulation (qui est lui-même issu du tarif client si le client a déjà un tarif), puis est ajustable manuellement par l'utilisateur (`offer_lines.final_price` et `offer_lines.discount_pct`). Cette logique correspond au workflow validé avec Olivier : « le prix projet part du tarif client existant, puis ajustable ».

### 7.3.4 Devis Gamma — Structure des 5 sections

Lorsque le modèle d'export est « devis Gamma », le document généré suit la structure validée par Olivier (mail du 08/04) :

**1. Executive Summary**

- Introduction Syskern / Unikkern (texte fixe, paramétrable dans la bibliothèque)
- Vision client + enjeux du projet (généré par IA à partir des infos projet et instructions IA)

**2. Understanding of Requirements**

- Reformulation du besoin client (généré par IA à partir des infos projet)
- Contraintes client identifiées (généré par IA)

**3. Technical Solution**

- Architecture (cuivre / fibre / rack) selon les produits sélectionnés
- Normes applicables (ISO, TIA, CPR…) — extraites des attributs produits si renseignées
- Design / schéma — non généré automatiquement en MVP1, espace réservé pour insertion manuelle

**4. Bill of Materials**

- Tableau des lignes : SKU, Description, Quantité, Prix unitaire, Total ligne
- Alternatives (champ libre, généré par IA si demandé via instructions)
- Méthode de revalorisation (prix fixes, variables, indexation cuivre) — issue des attributs produits et de la chaîne de calcul

**5. Project Organization**

- Phases : study → production → test → delivery → warranty (texte fixe paramétrable)
- Focus différenciation : USP produits/service, compliance matrix (texte fixe paramétrable + génération IA contextuelle)

### 7.3.5 Historique des versions

Une offre projet peut être révisée plusieurs fois (V1, V2, V3…). Chaque révision crée une nouvelle entrée `offers` liée à l'offre précédente via le champ `previous_offer_id` (à ajouter au modèle si pas déjà présent).

Les prix, les quantités et les arguments peuvent être modifiés à chaque version. L'historique complet est accessible depuis la vue détaillée d'une offre.

## 7.4 Bibliothèque de documents

### 7.4.1 Fichiers concernés

La bibliothèque de documents contient les fichiers fixes joignables aux offres projet, réutilisables d'un projet à l'autre :

- CGV (Conditions Générales de Vente)
- Garantie 30 ans (document de garantie standard)
- Project references (références projets passés)
- Quality management (procédures qualité)
- Compliance / certifications produits (marquages CE, certifications produit)
- Présentation entreprise
- Tout autre document fixe à joindre

Les fichiers sources seront fournis par Olivier (cf. mail du 08/04 où il mentionne avoir joint des documents propres aux produits : fiches techniques, DOP, certifications). Les fichiers sont stockés dans Supabase Storage et référencés dans la table `document_library` (cf. §3).

### 7.4.2 Multilingue

Un même document peut avoir plusieurs versions linguistiques (FR / EN / ES). La sélection au moment de la génération de l'offre prend automatiquement la version correspondant à la langue de l'offre, avec fallback sur FR si la version demandée n'existe pas.

### 7.4.3 Gestion

Une page d'administration permet à Olivier de :

- Uploader de nouveaux documents
- Catégoriser (cgv, warranty, quality, project_reference, company, other)
- Définir la langue
- Activer/désactiver un document (sans le supprimer)
- Réordonner l'affichage

Pas de versionning des documents en MVP1. Si Olivier upload une nouvelle version d'un document, l'ancienne est remplacée. À voir si nécessaire en MVP2.

### 7.4.4 Joindre au document final

Deux modes possibles selon le format de sortie :

- **Devis Gamma** : les documents sélectionnés sont fusionnés en un seul PDF avec le devis Gamma (devis en premier, puis documents annexes).
- **Excel** : les documents sélectionnés sont fournis dans une archive ZIP avec le fichier Excel.

## 7.5 Suivi des offres

### 7.5.1 Statuts

Les offres ont un cycle de vie matérialisé par un champ `status` :

- `draft` — offre créée mais non envoyée (état initial à la création)
- `sent` — offre marquée comme envoyée (transition manuelle par l'utilisateur après envoi externe)
- `won` — offre acceptée par le client (uniquement pour offres projet)
- `lost` — offre refusée par le client (uniquement pour offres projet)
- `expired` — date de fin de validité dépassée (transition automatique via cron)

**Les statuts `won` / `lost` ne s'appliquent qu'aux offres projet.** Les offres tarifaires n'ont pas de notion gagné/perdu — elles sont juste valides ou expirées. Cette distinction est explicitement validée par Olivier.

### 7.5.2 Vue liste

Une page « Offres » présente la liste des offres avec :

- Filtres : type (tarif/projet), client, date de création, période de validité, devise, statut
- Colonnes affichables : label, type, client(s), date de création, date de fin de validité, statut, montant total (projet uniquement)
- Tri par date, statut, montant
- Recherche textuelle sur label et nom de projet

L'inspiration UX est la vue liste d'Odoo (filtres latéraux, colonnes triables) — Olivier a explicitement demandé qu'on s'en inspire.

### 7.5.3 Dashboard de suivi

Un dashboard léger en haut de la page « Offres » présente :

- Nombre d'offres en cours par statut (draft, sent, won, lost, expired)
- Pour offres projet uniquement : taux de conversion (won / (won + lost))
- Pour offres projet uniquement : montant total des offres `won` sur la période
- Pour offres tarifaires uniquement : nombre de tarifs actifs (en cours de validité)
- Liste des offres expirant dans les 7 prochains jours

Ce dashboard reste **basique** — pas de CRM complet. Olivier a explicitement balisé : « pas un CRM, juste un suivi basique ».

### 7.5.4 Alerte d'expiration

Un job de fond quotidien parcourt les offres dont `valid_to` est dans les 7 prochains jours (ou `validity_duration_days` ramené à une date d'expiration calculée depuis `created_at` pour les offres projet) et déclenche une alerte visible dans le dashboard.

Les offres dépassées passent automatiquement en statut `expired`.

*Décision technique Boldys : implémentation via tâche Celery Beat (`django-celery-beat`), exécution quotidienne à 06:00 UTC.*

### 7.5.5 Suppression d'une offre

La suppression d'une offre est la **seule action destructrice** disponible côté utilisateur (cf. principe d'interface ouverte validé par Olivier : « pas d'erreur possible côté utilisateur sauf suppression d'offre »).

- Supprimer une offre `won` ou `lost` : possible mais avec confirmation (perte d'historique)
- Supprimer une offre projet liée à une simulation : la simulation source n'est pas supprimée
- Une offre supprimée ne peut pas être restaurée

## 7.6 IA et traduction

### 7.6.1 Génération de copy IA

La génération de copy IA intervient à deux niveaux :

**Niveau Gamma (offre projet)** : l'API Gamma reçoit un prompt structuré incluant le nom du projet, les infos projet, les instructions IA libres saisies par l'utilisateur, et la liste des produits avec leurs prix. Gamma génère le devis avec sa propre IA selon la structure des 5 sections (cf. §7.3.4) et la charte graphique Syskern fournie.

**Niveau plateforme (argumentaires et descriptions)** : OpenAI (GPT-4 ou équivalent) est utilisé pour générer :

- L'argumentaire de justification prix (offre tarifaire ET projet)
- La reformulation du besoin client (offre projet)
- Les contraintes client identifiées (offre projet)
- Les alternatives produits (offre projet, si demandé)

### 7.6.2 Traduction

📌 **Décision archi** : DeepL est utilisé pour la traduction des contenus produits et des descriptions (qualité supérieure pour les langues européennes). OpenAI est utilisé pour la génération de copy contextuelle qui ne se résume pas à de la traduction.

La traduction intervient :

- À la génération d'une offre dans une langue ≠ FR : descriptions produits, argumentaires, intitulés des sections du devis
- À l'enrichissement initial de la base produits (descriptions multilingues)

Les traductions générées sont mises en cache dans la base (champ JSONB `description_marketing` et `description_technical` par langue) pour éviter les appels DeepL répétés.

### 7.6.3 Garde-fous

Les systèmes IA sont utilisés pour de la rédaction et de la traduction uniquement. **L'IA ne génère jamais de prix.** Les prix sont calculés exclusivement par le moteur de calcul déterministe (cf. §6).

Les contenus générés par IA sont éditables manuellement par l'utilisateur avant validation finale de l'offre. Aucun contenu IA n'est verrouillé ou non modifiable.

## 7.7 Charte graphique et templates Gamma

### 7.7.1 Charte Syskern

La génération via Gamma respecte strictement la charte graphique Syskern : couleurs, typographies, logos, mise en page. Les éléments de charte sont fournis par Olivier (mail du 08/04, lien pCloud — fichiers déjà partagés).

### 7.7.2 Templates Gamma modifiables par le client

📌 **Décision validée** : les templates Gamma utilisés par la plateforme sont stockés dans le compte Gamma de Syskern et **modifiables directement par le client après livraison**. La plateforme appelle l'API Gamma en référençant l'ID du template (configurable via variable d'environnement `GAMMA_TEMPLATE_ID_DEVIS_PROJET` et `GAMMA_TEMPLATE_ID_CATALOGUE_TARIFE`).

Ce choix permet à Olivier de faire évoluer la mise en forme des devis sans intervention dev de Boldys après livraison.

## 7.8 Endpoints API

```
# Offres - CRUD
GET    /api/offers                                # Liste paginée avec filtres
POST   /api/offers                                # Création depuis simulation
GET    /api/offers/{id}                           # Détail
PATCH  /api/offers/{id}                           # Modification (champs configurables)
DELETE /api/offers/{id}                           # Suppression (seule action destructrice)

# Lignes d'offre
GET    /api/offers/{id}/lines                     # Liste des lignes
PATCH  /api/offers/{id}/lines/{line_id}           # Ajustement prix/quantité d'une ligne

# Génération
POST   /api/offers/{id}/generate                  # Déclenche la génération du document final
GET    /api/offers/{id}/generation-status         # Statut de génération (Gamma async)
GET    /api/offers/{id}/download                  # Téléchargement du document généré

# Statuts
PATCH  /api/offers/{id}/status                    # Transition de statut (draft → sent → won/lost)

# Versioning (offre projet)
POST   /api/offers/{id}/duplicate                 # Crée une nouvelle version (V2, V3…)
GET    /api/offers/{id}/versions                  # Historique des versions

# Bibliothèque de documents
GET    /api/document-library                      # Liste des documents fixes
POST   /api/document-library                      # Upload nouveau document
PATCH  /api/document-library/{id}                 # Modification métadonnées
DELETE /api/document-library/{id}                 # Suppression

# Dashboard
GET    /api/offers/dashboard                      # Métriques agrégées
GET    /api/offers/expiring-soon                  # Offres expirant dans les 7 jours
```

## 7.9 Règles d'intégrité

1. Une offre référence toujours une simulation finalisée (`simulation_id` non nul, `simulations.status = 'finalized'`).
2. Une offre tarifaire peut référencer N clients (`client_ids` array). Une offre projet référence exactement 1 client (`client_ids` contient un seul élément).
3. Le statut `won` ou `lost` n'est applicable qu'aux offres de type `project`. La transition est bloquée pour les offres `tariff`.
4. La suppression d'une simulation est interdite si une offre y est attachée (cf. §6.9.10). Elle peut être archivée à la place.
5. Un document de la bibliothèque référencé par au moins une offre ne peut pas être supprimé physiquement, seulement désactivé (`is_active = false`).
6. La conversion de devise au moment de la génération utilise les taux figés dans `simulations.market_params`, **pas** les taux courants. Ceci garantit que deux offres générées depuis la même simulation à des moments différents auront les mêmes prix.

---

# 8. Brique 5 — Migration des données initiales

## 8.1 Vue d'ensemble

La migration des données initiales est une **opération one-shot** exécutée par l'équipe Boldys au moment du déploiement de la plateforme. Elle a pour objectif de constituer la base produits initiale à partir des sources de données existantes du client (Odoo + fichiers Excel), avant que la sync Odoo automatique (cf. §5) ne prenne le relais pour les mises à jour courantes.

Cette opération n'est pas un outil produit : il n'y a pas d'interface utilisateur d'import dans la plateforme. C'est un script exécuté manuellement par Boldys, sur la base de fichiers fournis par le client dans un format convenu.

## 8.2 Périmètre et limitations

**Ce qui est pris en charge par la migration :**

- Import du tronc commun produits depuis Odoo (synchronisation initiale complète de la base article)
- Enrichissement depuis les fichiers Excel fournis par le client (PO fournisseurs, attributs techniques, marketing, données de la « Database interne »)
- Dérivation automatique des champs calculables (cf. §8.5)
- Détection et reporting des incohérences (lignes non matchables, doublons)

**Ce qui n'est pas pris en charge :**

- Le nettoyage et la mise en qualité des fichiers source restent à la charge du client (cf. article 4 du contrat-cadre).
- Les données non structurées (fiches techniques PDF, contenus de sites web, catalogues commerciaux) ne sont pas importées automatiquement. Olivier a estimé que ~85% des informations utiles sont dans les fichiers Excel, le reste devra être saisi manuellement dans la plateforme après la migration via les fonctionnalités d'édition de la brique 1 (cf. §4).
- L'import est unique. Aucun outil d'import Excel ad-hoc réutilisable n'est livré dans le MVP1. Les ajouts ultérieurs de produits passent par la création manuelle dans l'interface ou par la sync Odoo.

## 8.3 Prérequis côté client

Pour que la migration soit exécutable dans des conditions normales, le client doit fournir :

1. **Accès API Odoo en lecture** sur l'instance de production (ou staging avec données réelles), couvrant les modèles `product.template`, `product.product`, `product.supplierinfo`, `stock.quant`, `res.partner`.
2. **Fichiers Excel sources finalisés**, dans un format convenu :
    - **Fichier PO fournisseurs** : un format unique par typologie (prix net, prix indexé cuivre), avec colonnes structurées. Le SKU Syskern doit être présent sur toutes les lignes. Si plusieurs fichiers sont fournis (un par fournisseur ou un par typologie), chacun doit respecter un format cohérent.
    - **Fichier technique / UUID** : attributs techniques structurés par SKU.
    - **Database interne** : produits non présents dans Odoo, avec leurs logiques de calcul et leurs PO.
3. **Référentiels métier** validés par le client :
    - Liste des incoterms utilisés en pratique (achat et vente)
    - Liste des modes de transport utilisés avec leurs valeurs par défaut (nombre de palettes par conteneur)
    - Cours du cuivre du jour et taux de change EUR/USD/RMB à utiliser pour le premier calcul
4. **Points de contact dédiés** : Olivier (questions métier sur les données) et Ghang Hui (questions techniques sur Odoo) disponibles pendant la phase de migration pour arbitrer les cas ambigus.

**Si les prérequis ne sont pas tenus**, les lignes concernées ne sont pas importées automatiquement et sont mises dans une table de quarantaine (cf. §8.7) pour traitement manuel par le client. La charge de Boldys ne couvre pas le retraitement des fichiers mal formés.

## 8.4 Pipeline de migration

La migration s'exécute en 4 étapes séquentielles :

```jsx
Étape 1                Étape 2                Étape 3                Étape 4
Sync Odoo      ───►    Enrichissement  ───►    Création des     ───►    Validation
initiale               Excel                  hors-Odoo              et dérivations
```

### Étape 1 — Sync Odoo initiale

Utilise la couche d'abstraction Odoo (cf. §5) pour récupérer en lecture l'ensemble du tronc commun produits :

- Tous les produits actifs (`product.template` + `product.product`)
- Mapping des champs Odoo vers les champs `products` de Supabase (nom, code, catégorie, conditionnement, poids, HS code, GTIN, descriptions multilingues quand disponibles)
- Niveau de stock courant (`stock.quant` agrégé par produit)
- PAMP courant (`standard_price`)
- Fournisseurs associés (`product.supplierinfo`) avec leurs PO de référence et incoterms

Chaque produit est inséré dans la table `products` avec son `odoo_id` rempli. Les fournisseurs sont insérés dans `product_suppliers`.

### Étape 2 — Enrichissement depuis les fichiers Excel

Pour chaque fichier Excel fourni par le client, un script de chargement dédié est écrit (un script par fichier source, en fonction de son format réel). Le script :

1. Lit le fichier (via `pandas` + `openpyxl`)
2. Effectue le matching avec les produits déjà importés depuis Odoo (cf. §8.6)
3. Met à jour les champs enrichis : descriptions marketing, attributs techniques, PO fournisseurs si plus détaillés qu'Odoo, attributs custom (via `product_attribute_values`)
4. Logge les lignes non matchables dans la table de quarantaine

Un script par fichier, plutôt qu'un import générique : c'est un compromis assumé, justifié par l'hétérogénéité des formats sources. Les scripts sont versés dans le repo Boldys et conservés dans `backend/apps/data_migration/`.

### Étape 3 — Création des produits hors-Odoo

Certains produits de la « Database interne » d'Olivier n'existent pas dans Odoo. Ils sont insérés directement dans la table `products` avec `odoo_id = NULL`.

Un champ technique `migration_source` est ajouté à la table `products` pour tracer l'origine de chaque ligne :

```
ALTER TABLE products ADD COLUMN migration_source TEXT;
-- Valeurs possibles : 'odoo', 'excel_pricing', 'excel_technical', 'database_internal', 'manual'
```

Ces produits hors-Odoo restent dans la plateforme tant qu'Olivier ne les crée pas dans Odoo. La création dans Odoo se fait manuellement par Olivier via l'interface plateforme (cf. §5 sur la sync bidirectionnelle).

### Étape 4 — Validation et dérivations

Une fois les données brutes insérées, un script de dérivation et de validation est exécuté. Il :

1. **Dérive les champs calculables** (cf. §8.5)
2. **Valide la cohérence** :
    - Tous les SKU ont un `name` non vide
    - Tous les SKU indexés cuivre ont un `copper_weight_kg_per_unit` > 0
    - Tous les SKU avec un fournisseur actif ont un `po_base_price`, une `po_currency` et un `incoterm`
    - Pas de doublons sur `sku_code`
3. **Logge les anomalies** dans la table de quarantaine pour traitement manuel

La migration ne fait pas de tentative automatique de correction. Les anomalies sont reportées au client pour arbitrage.

## 8.5 Dérivations automatiques

Les champs suivants sont **calculés par la migration** à partir des données brutes des sources, sans intervention manuelle :

| Champ dérivé | Règle de dérivation | Source |
| --- | --- | --- |
| `is_copper_indexed` | `true` si `copper_weight_kg_per_unit > 0`, sinon `false` | Présence d'un poids cuivre dans le fichier source |
| `factory_code` | Suffixe extrait du `sku_code` selon le pattern Symea (ex: `KCFF6A4PZHDBL5-21` → `21`) | Convention de nommage SKU Syskern |
| `parent_reference` | Code SKU avant le suffixe `-XX` (ex: `KCFF6A4PZHDBL5-21` → `KCFF6A4PZHDBL5`) | Convention de nommage SKU Syskern |
| `base_unit` | `'km'` si la catégorie produit contient « câble », sinon `'unit'` | Règle métier confirmée par Olivier (un câble se vend au km) |
| `pamp_eur` (snapshot) | `standard_price` Odoo converti en EUR si la devise produit Odoo est différente | Lecture Odoo + taux de change saisi |
| `is_active` | `true` par défaut, sauf si le produit est marqué comme archivé dans Odoo | Champ `active` Odoo |

Ces règles sont implémentées dans un module Python dédié (`backend/apps/data_migration/derivations.py`) et testées unitairement.

## 8.6 Règles de matching entre sources

L'enjeu est d'identifier qu'une ligne d'un fichier Excel correspond bien à un produit déjà créé (par Odoo à l'étape 1, ou par un Excel précédent), pour pouvoir l'enrichir plutôt que créer un doublon.

La stratégie de matching applique les règles suivantes **dans cet ordre** :

1. **Match exact sur `sku_code`** : la règle prioritaire. Si la ligne Excel contient un SKU Symea identique à un produit existant, c'est un match.
2. **Match sur `parent_reference` + `factory_code`** : si la ligne Excel ne contient pas le SKU Symea complet mais une référence générique + un code usine, on tente de retrouver le SKU correspondant.
3. **Match sur `factory_code` seul + catégorie** : tentative de dernière chance pour les fichiers fournisseurs hétérogènes. À utiliser uniquement si les deux premières règles échouent.
4. **Aucun match trouvé** : la ligne est mise dans la table de quarantaine (`migration_unmatched`) avec son contenu brut et le nom du fichier source. Olivier peut ensuite traiter ces lignes manuellement.

Ces règles sont conservatives : en cas d'ambiguïté (plusieurs candidats possibles), la ligne va en quarantaine plutôt que d'être matchuée arbitrairement.

## 8.7 Table de quarantaine

```
CREATE TABLE migration_unmatched (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	source_file TEXT NOT NULL,                 -- Nom du fichier source (ex: 'PO_Symea_Shanghai_2026-04.xlsx')
	source_row_number INTEGER,                 -- Numéro de ligne dans le fichier (pour identification)
	raw_data JSONB NOT NULL,                   -- Contenu brut de la ligne
	reason TEXT NOT NULL,                      -- 'no_sku', 'no_match', 'duplicate_match', 'invalid_format', 'missing_required_field'
	-- Action manuelle
	resolved_at TIMESTAMPTZ,
	resolved_by TEXT,                          -- Email de la personne qui a résolu
	resolution_notes TEXT,                     -- Commenté par celui qui a résolu
	created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_migration_unmatched_source ON migration_unmatched(source_file, resolved_at);
CREATE INDEX idx_migration_unmatched_reason ON migration_unmatched(reason);
```

Une page d'administration simple permet à Olivier de :

- Lister les lignes en quarantaine (filtres par fichier source, par raison)
- Voir le contenu brut de chaque ligne
- Marquer une ligne comme résolue (avec une note libre)

Il n'y a **pas** de fonctionnalité dans l'UI pour réparer une ligne et la ré-injecter automatiquement. Si Olivier identifie qu'une ligne en quarantaine correspond à un produit qu'il faut créer, il le crée manuellement via l'interface d'édition produits (cf. §4) et marque la ligne quarantaine comme résolue.

## 8.8 Reporting de migration

À l'issue de la migration, un rapport synthétique est généré et transmis à Olivier (Excel + résumé par mail). Il contient :

- Nombre total de produits importés, par source (`odoo`, `excel_pricing`, `excel_technical`, `database_internal`)
- Nombre de produits mis à jour vs. créés
- Nombre de fournisseurs créés
- Nombre d'attributs distincts découverts et créés dans le registre
- Liste des lignes en quarantaine avec leur raison
- Résumé des dérivations appliquées (ex: « 1 247 produits identifiés comme indexés cuivre »)
- Statistiques de la simulation initiale (nombre de SKU calculés, PV moyen par gamme, anomalies de calcul éventuelles)

Ce rapport sert de point de validation croisée avec Olivier avant la mise en production de la plateforme.

## 8.9 Reproductibilité

La migration peut être rejouée intégralement sur un environnement vierge si nécessaire (ex: incident, repli sur un environnement de secours). Pour cela :

- Les fichiers source utilisés sont versés dans un répertoire dédié (`migration/sources/`) du repo Boldys, conservés en l'état
- Les scripts de chargement sont versionnés dans le repo (`backend/app/migration/`)
- Un script orchestrateur (`backend/apps/data_migration/run_migration.py`) exécute les 4 étapes dans l'ordre, avec des points de reprise si nécessaire
- Un script de purge (`backend/apps/data_migration/reset.py`) permet de remettre la base à zéro avant un re-jeu (à utiliser uniquement avant la mise en production)

Après la mise en production, le re-jeu de la migration est interdit (risque de perte de données enrichies par Olivier post-migration). Un mécanisme de garde-fou (variable d'environnement `MIGRATION_LOCKED=true`) bloque l'exécution accidentelle.

---

# 9. Authentification et sécurité

## 9.1 Authentification

### 9.1.1 Choix technique

📌 **Décision archi structurante** : l'authentification s'appuie sur **Supabase Auth** (composant GoTrue) en self-hosted, intégré au stack Supabase déployé sur le VPS OVH (cf. §9.4). Ce choix élimine la nécessité de coder un système d'auth maison : Supabase Auth gère le stockage du mot de passe (hashé bcrypt), la session JWT, le refresh token automatique, et expose des SDK clients prêts à l'emploi pour Next.js et Python.

### 9.1.2 Modèle utilisateur en MVP1

MVP1 utilise un compte unique partagé. Concrètement :

- Un seul utilisateur Supabase est créé manuellement par Boldys au déploiement
- Les credentials sont communiqués à Olivier qui les partage en interne avec Paul, Massinissa et toute personne de l'équipe Syskern qui doit accéder à la plateforme
- Pas d'inscription publique (`signup` désactivé côté config Supabase Auth)
- Pas de récupération de mot de passe par email (le mot de passe est connu de l'équipe Syskern et peut être réinitialisé manuellement par Boldys si nécessaire)

**Limitation explicite assumée** : pas de traçabilité de qui fait quoi. Toutes les actions apparaissent comme effectuées par le compte unique. Cette limitation est documentée dans l'annexe technique et levée en MVP3 avec la gestion multi-utilisateurs.

### 9.1.3 Flux de connexion

1. L'utilisateur arrive sur `/login`
2. Saisit l'email du compte unique + mot de passe
3. Le frontend appelle `supabase.auth.signInWithPassword({email, password})`
4. Supabase Auth vérifie les credentials, retourne une paire access token (JWT, durée 1h) + refresh token (durée 7j)
5. Les tokens sont stockés dans un cookie httpOnly côté Next.js (pas en localStorage, pour éviter l'exposition au XSS)
6. Toutes les requêtes API suivantes incluent l'access token dans le header `Authorization: Bearer <token>`
7. La DRF Authentication class Django vérifie la signature du JWT auprès de Supabase Auth (clé publique cachée localement)

### 9.1.4 Durée de session et refresh

- **Access token** : durée 1h (paramètre Supabase Auth `JWT_EXP=3600`)
- **Refresh token** : durée 7j (paramètre `REFRESH_TOKEN_ROTATION_ENABLED=true`)
- **Sliding session** : le refresh token est automatiquement renouvelé à chaque utilisation (rotation), prolongeant la session de 7j supplémentaires
- **Conséquence** : tant qu'Olivier utilise la plateforme régulièrement (au moins une fois tous les 7 jours), il n'a pas à se reconnecter
- **Inactivité > 7 jours** : reconnexion requise au prochain accès

### 9.1.5 Logout

- Bouton « Se déconnecter » dans le menu utilisateur
- Appel à `supabase.auth.signOut()` qui invalide le refresh token côté Supabase
- Suppression des cookies de session côté frontend
- Redirection vers `/login`

### 9.1.6 Rate limiting sur le login

Protection contre les tentatives de brute force sur le mot de passe :

- **Limite** : 5 tentatives échouées par IP source sur une fenêtre glissante de 15 minutes
- **Implémentation** : Django middleware (ou DRF throttle) sur l'endpoint de proxy `/api/auth/login`, avec compteur stocké en Redis ou directement dans une table Postgres `auth_rate_limit`
- **Comportement au-delà** : la 6e tentative et les suivantes retournent `429 Too Many Requests` avec un header `Retry-After`
- **Reset** : le compteur se reset après une connexion réussie ou à expiration de la fenêtre

## 9.2 Gestion des secrets

### 9.2.1 Stockage

Les secrets de l'application sont stockés dans un fichier `.env` sur le VPS OVH, à l'emplacement standard du projet déployé. Règles :

- Fichier non versionné (présent dans `.gitignore`)
- Droits Unix `0600` (lecture seule par l'utilisateur applicatif)
- Propriétaire : utilisateur applicatif dédié (jamais `root`)
- Pas de logging des valeurs des variables d'environnement (filtres dans la config de logging)

### 9.2.2 Variables sensibles

La liste des variables sensibles à protéger :

- `SUPABASE_SERVICE_ROLE_KEY` : clé service role Supabase (pleins droits sur la BDD)
- `SUPABASE_JWT_SECRET` : secret de signature des JWT
- `ODOO_API_PASSWORD` : mot de passe du compte API Odoo
- `GAMMA_API_KEY` : clé API Gamma
- `DEEPL_API_KEY` : clé API DeepL
- `OPENAI_API_KEY` : clé API OpenAI
- `S3_ACCESS_KEY_ID` et `S3_SECRET_ACCESS_KEY` : credentials du stockage S3 pour les backups (cf. §9.4)

### 9.2.3 Procédure de rotation

Les secrets doivent être rotés :

- À la livraison initiale (Boldys configure les credentials de production)
- En cas de fuite suspectée (action immédiate)

Procédure : génération d'un nouveau secret côté fournisseur (Odoo, Gamma, DeepL, OpenAI), mise à jour du `.env`, redémarrage du service applicatif. Pas d'interface de gestion des secrets dans la plateforme en MVP1.

## 9.3 HTTPS et chiffrement en transit

### 9.3.1 Reverse proxy Nginx

Le VPS OVH héberge un reverse proxy Nginx qui termine le TLS et route le trafic vers les services applicatifs (frontend Next.js sur port interne, backend Django / gunicorn sur port interne, Supabase services). Le frontend et le backend ne sont pas exposés directement sur Internet.

### 9.3.2 Certificats Let's Encrypt

Certificats TLS générés par Let's Encrypt via `certbot`, avec auto-renouvellement automatique (cron mensuel). Domaines couverts :

- `app.<domain-syskern>.com` ou équivalent (frontend)
- `api.<domain-syskern>.com` (backend, optionnel si exposé)

Le domaine final sera défini avec Syskern à la livraison.

### 9.3.3 Redirection HTTP → HTTPS

Nginx configure une redirection 301 permanente de tout trafic `http://` vers `https://`. Aucun trafic en clair n'est servi.

### 9.3.4 Headers de sécurité

Nginx ajoute les headers HTTP suivants sur toutes les réponses :

- `Strict-Transport-Security: max-age=31536000; includeSubDomains` (HSTS, force HTTPS pendant 1 an)
- `X-Frame-Options: DENY` (empêche le clickjacking)
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Content-Security-Policy` : politique restrictive limitant les origines autorisées. La liste des domaines autorisés (Gamma, DeepL, OpenAI, Supabase) est configurée dans Nginx en fonction des intégrations effectivement mobilisées par l'application.

## 9.4 Sauvegardes

### 9.4.1 Contexte

La plateforme est déployée avec Supabase en self-hosted sur le VPS OVH. Contrairement au Supabase managé qui inclut des backups automatiques natifs, le self-hosted impose à Boldys de mettre en place sa propre stratégie de sauvegarde.

### 9.4.2 Stratégie de backup

📌 **Décision archi** : backup quotidien automatique vers un bucket S3 (OVH Object Storage ou équivalent compatible S3), couvrant la base Postgres et le Storage Supabase.

**Composants sauvegardés** :

1. **Base Postgres** : dump complet via `pg_dump` au format `custom` (compressé, restaurable avec `pg_restore`)
2. **Storage Supabase** : synchronisation des fichiers (documents joints, fichiers générés) via `rclone` ou `aws s3 sync`
3. **Configuration applicative** : copie du fichier `.env` chiffré avec une clé GPG dédiée (la clé GPG est stockée hors-VPS, dans le coffre Boldys)

### 9.4.3 Fréquence et rétention

- **Fréquence** : 1 backup par jour à 02:00 UTC (heure creuse, avant le sync Odoo programmé à 03:00)
- **Rétention** : 7 jours glissants (les backups plus anciens sont supprimés automatiquement)
- **Best-effort 30 jours** : option configurable si le client souhaite étendre la rétention (impact stockage S3 marginal, à activer côté script)

### 9.4.4 Implémentation

Un script bash (`backup.sh`) déclenché par cron quotidien orchestre les opérations :

```
#!/bin/bash
# Backup quotidien Supabase self-hosted vers S3

DATE=$(date +%Y-%m-%d_%H-%M-%S)
BACKUP_DIR=/var/backups/syskern-pricing
S3_BUCKET=s3://syskern-pricing-backups

# 1. Dump Postgres
pg_dump -h localhost -U postgres -F c -f $BACKUP_DIR/db_$DATE.dump syskern_pricing

# 2. Sync Storage
rclone sync /var/lib/supabase/storage $BACKUP_DIR/storage_$DATE/

# 3. Backup .env chiffré
gpg --encrypt --recipient backup@boldys.ai /opt/app/.env -o $BACKUP_DIR/env_$DATE.gpg

# 4. Upload vers S3
aws s3 sync $BACKUP_DIR $S3_BUCKET/$DATE/ --storage-class STANDARD_IA

# 5. Nettoyage local et purge des backups S3 \> 7 jours
find $BACKUP_DIR -mtime +1 -delete
aws s3 ls $S3_BUCKET/ | awk '{print $2}' | head -n -7 | xargs -I {} aws s3 rm $S3_BUCKET/{} --recursive
```

Le script est versionné dans le repo Boldys (`infra/backup.sh`) et déployé sur le VPS lors du provisioning.

### 9.4.5 Vérification et restauration

- **Vérification automatique** : un test de cohérence (`pg_restore --list` sur le dump du jour) est exécuté après chaque backup. En cas d'échec, une notification email est envoyée à `yassine@boldys.ai` et `karim@boldys.ai`.
- **Procédure de restauration documentée** : runbook dans le repo (`docs/runbooks/restore.md`) décrivant les étapes de restauration depuis S3 vers une instance neuve.

### 9.4.6 RTO/RPO indicatifs

Valeurs cibles best-effort, **non engagées contractuellement en MVP1** :

- **RPO (Recovery Point Objective)** : 24 heures (perte maximale = 1 jour de données)
- **RTO (Recovery Time Objective)** : 4 heures (temps maximal de remise en service à partir du dernier backup)

Des engagements RTO/RPO contractuels nécessiteraient une infrastructure plus sophistiquée (réplication, hot standby) hors scope MVP1. Ils pourront être ajoutés dans le contrat de maintenance.

### 9.4.7 Périmètre de responsabilité

- **Mise en place du système de backup** : scope MVP1, livrable du déploiement initial.
- **Opération continue** (vérification quotidienne que les backups passent, alerte en cas d'échec, restauration en cas d'incident) : périmètre du **contrat de maintenance** à rédiger séparément après livraison.

## 9.5 Chiffrement au repos

Aucun chiffrement custom au-delà de ce que Postgres et le système d'exploitation fournissent nativement.

- **Postgres** : pas de chiffrement transparent natif, mais le disque du VPS OVH est chiffré (AES-256 au niveau bloc) — vérifier la configuration OVH au provisioning.
- **Storage Supabase** : fichiers stockés en clair sur le disque VPS (chiffré au niveau bloc).
- **Backups S3** : chiffrement côté serveur S3 activé (`SSE-S3` ou `SSE-KMS` selon la configuration OVH Object Storage), plus le `.env` chiffré GPG.

Cette approche est cohérente avec le niveau de sensibilité des données du MVP1 (données commerciales, pas de données personnelles sensibles, pas de données de santé). Une élévation du niveau de chiffrement nécessiterait une analyse de risque dédiée.

## 9.6 Logs et monitoring

### 9.6.1 Logs techniques

Les logs techniques couvrent les opérations système et applicatives standards :

- **Logs Django / gunicorn** : requêtes HTTP entrantes (méthode, path, status, durée), exceptions Python, erreurs métier traitées
- **Logs frontend** : non collectés côté serveur en MVP1 (les erreurs JS restent dans la console navigateur)
- **Logs Nginx** : access log + error log standard
- **Logs Postgres** : queries lentes (`log_min_duration_statement = 500ms`), erreurs
- **Logs sync Odoo** : centralisés dans la table `sync_logs` (cf. §5.4.3)

### 9.6.2 Filtrage des données sensibles

Le middleware de logging Django applique un filtre qui masque les valeurs sensibles avant écriture :

- Tokens d'authentification (`Authorization`, `Cookie`)
- Mots de passe en clair dans les payloads (champ `password`)
- Clés API tierces

Les valeurs masquées apparaissent comme `***REDACTED***` dans les logs.

### 9.6.3 Stockage et rotation

- **Localisation** : `/var/log/syskern-pricing/` sur le VPS
- **Rotation** : `logrotate` configuré pour rotation quotidienne, compression au bout de 1 jour, suppression au bout de 30 jours
- **Pas de centralisation externe** (Datadog, Loki, etc.) en MVP1 — ajout possible en MVP2 si besoin

### 9.6.4 Audit métier

❌ **Hors scope MVP1**. L'audit trail (qui a fait quoi sur quel objet) est explicitement repoussé en **MVP2**, en cohérence avec la décision de ne pas avoir de gestion d'utilisateurs en MVP1 (sans utilisateur identifié, l'audit perd l'essentiel de sa valeur).

### 9.6.5 Monitoring d'infrastructure

Monitoring minimal en MVP1 :

- **Healthcheck endpoint** `/api/health` exposé par le backend Django + gunicorn, retournant `200 OK` si la BDD répond et le service tourne
- **Uptime monitoring externe** (UptimeRobot, BetterStack, ou équivalent) configuré par Boldys, pingant `/api/health` toutes les 5 minutes
- **Alerte email** sur `yassine@boldys.ai` et `karim@boldys.ai` en cas de downtime > 5 minutes
- **Pas de dashboards de métriques applicatives** en MVP1 (CPU, RAM, latences) — visibilité limitée à la console OVH du VPS

## 9.7 Synthèse des décisions de sécurité

| Aspect | Décision MVP1 |
| --- | --- |
| Authentification | Supabase Auth self-hosted, compte unique partagé |
| Session | JWT 1h + refresh 7j avec rotation glissante |
| Rate limiting login | 5 tentatives / 15 min par IP |
| Secrets | `.env` 0600 sur VPS, rotation manuelle |
| HTTPS | Nginx + Let's Encrypt + headers HSTS/CSP |
| Backups | Quotidien vers S3, rétention 7j, RTO/RPO indicatifs (24h/4h) |
| Chiffrement repos | Disque VPS chiffré + S3 SSE, pas de chiffrement custom |
| Logs | Techniques uniquement, rotation 30j, pas d'audit métier |
| Monitoring | Healthcheck + uptime externe, pas de métriques applicatives |

---

# 10. Multilingue — FR / EN / ES

## 10.1 Périmètre du multilingue

Le multilingue couvre uniquement le **contenu produit et les sorties commerciales**, pas l'interface utilisateur.

**Multilingue (FR / EN / ES)** :

- Descriptions marketing des produits (`products.description_marketing`)
- Descriptions techniques des produits (`products.description_technical`)
- Labels des attributs dans le registre (`attribute_registry.label`)
- Options des attributs select / multiselect (`attribute_registry.options.label`)
- Labels des modes de transport (`transport_modes.label`)
- Noms et descriptions des documents de la bibliothèque (`document_library.name`)
- Documents joints aux offres projet (versions linguistiques distinctes par fichier)
- Contenu généré des offres tarifaires et projet (texte injectable, argumentaires, justifications de prix)

**Pas multilingue (FR uniquement)** :

- Interface utilisateur de la plateforme : menus, boutons, libellés de formulaires, messages d'erreur, tooltips. L'équipe Syskern (Olivier, Paul, Massinissa) travaille en français.
- Logs applicatifs et messages techniques
- Communication équipe Boldys / Syskern (mails, documentation interne)

L'i18n de l'interface est explicitement repoussée à un MVP ultérieur si le besoin apparaît (ouverture à une équipe internationale interne, par exemple).

**Langue de référence** : le **français est la langue source** pour tous les contenus multilingues. Les versions EN et ES sont dérivées de la version FR (par traduction manuelle ou via DeepL). En cas d'incohérence entre les versions, c'est la version FR qui fait foi.

## 10.2 Stockage des contenus multilingues

Les contenus multilingues sont stockés en **JSONB** dans la base, avec une clé par code langue ISO 639-1 (`fr`, `en`, `es`).

Exemple pour `products.description_marketing` :

```json
{
  "fr": "Câble catégorie 7 blindé, conforme aux normes...",
  "en": "Shielded category 7 cable, compliant with...",
  "es": "Cable categoría 7 blindado, conforme a las normas..."
}
```

**Règles** :

- La clé `fr` est obligatoire à la création d'un produit. Les clés `en` et `es` sont optionnelles.
- Une clé absente ou vide signifie « non traduit ». L'UI affiche un placeholder distinct pour ce cas.
- L'API expose des endpoints qui retournent soit l'objet JSONB complet, soit la valeur d'une langue spécifique (paramètre `?lang=en`).

## 10.3 Workflow de traduction des contenus produits

### 10.3.1 Saisie initiale

La saisie d'un produit (cf. §4) impose la version FR. Les champs EN et ES sont visibles dans la fiche produit avec un état « Non traduit » par défaut.

L'utilisateur peut :

- Saisir manuellement les versions EN et ES en parallèle de la FR
- Laisser les versions EN et ES vides et les traduire ultérieurement
- Déclencher une traduction automatique

### 10.3.2 Traduction automatique à la demande

📌 **Décision archi** : aucune traduction automatique de masse n'est exécutée par la plateforme. Ni au moment de la migration initiale, ni en arrière-plan. Toutes les traductions automatiques sont déclenchées **explicitement par l'utilisateur**, sur des actions ciblées.

**Trois niveaux de déclenchement** :

- **Au niveau d'un champ** : bouton « Traduire » à côté du champ EN ou ES dans la fiche produit. Traduit uniquement le champ depuis la version FR.
- **Au niveau d'un produit** : bouton « Traduire toutes les langues manquantes » dans la fiche produit. Traduit `description_marketing` et `description_technical` de FR vers EN et ES si manquants.
- **Au niveau du catalogue** (action bulk) : depuis la vue catalogue avec une sélection multiple, action « Traduire la sélection ». Traite les produits sélectionnés en tâche de fond avec barre de progression.

Dans tous les cas, la traduction est faite via l'API DeepL (cf. §10.4). Les valeurs traduites sont éditables manuellement par l'utilisateur après génération.

### 10.3.3 Mise à jour et invalidation

Lorsque l'utilisateur modifie la version FR d'un champ multilingue, les versions EN et ES **ne sont pas invalidées automatiquement**. Elles restent en l'état. C'est à l'utilisateur de :

- Soit retraduire manuellement (ou via le bouton « Traduire »)
- Soit accepter l'écart entre la version FR et les autres langues

Un indicateur visuel léger s'affiche dans la fiche produit pour signaler que la version FR a été modifiée après la dernière traduction (champ technique `description_marketing_translated_at` comparé à `description_marketing_updated_at` de la version FR). Cet indicateur est purement informatif, il ne bloque rien.

Ce choix évite des traductions automatiques inutiles (correction de typo FR qui invaliderait des traductions parfaitement valides) et garde l'utilisateur en contrôle.

### 10.3.4 Pas de traduction à la migration initiale

Lors de la migration des données initiales (cf. §8), les descriptions issues d'Odoo et des fichiers Excel sont importées en l'état dans la clé `fr` de la JSONB. Les clés `en` et `es` sont laissées vides.

Olivier déclenche les traductions ensuite, soit produit par produit, soit en bulk depuis la vue catalogue, selon ses priorités commerciales (clients export réels à servir en EN ou ES).

Ce choix se justifie par : coût DeepL maîtrisé, données fraîchement migrées susceptibles d'être revues par Olivier avant traduction, autonomie du client sur le rythme d'enrichissement.

## 10.4 Service de traduction — DeepL

📌 **Décision archi** : DeepL est l'unique service utilisé pour la traduction des contenus produits et des libellés d'attributs. Choix justifié par la qualité supérieure de DeepL pour les langues européennes (FR, EN, ES sont dans le top des paires supportées par DeepL).

OpenAI reste utilisé pour la **génération de copy contextuelle** (cf. §7.6.1), pas pour de la traduction.

### 10.4.1 Intégration technique

- API REST DeepL (`https://api.deepl.com/v2/translate`)
- Clé API stockée en variable d'environnement `DEEPL_API_KEY`
- Client HTTP async dans `backend/app/services/translation.py`
- Paramètres : `formality=more` (registre formel adapté au contexte B2B), `preserve_formatting=true`

### 10.4.2 Endpoint API interne

```jsx
POST /api/translate
Body : {
  "source_text": "...",
  "source_lang": "fr",
  "target_lang": "en",  // ou "es"
  "context": "product_description"  // optionnel, sert au logging
}
Response : {
  "translated_text": "...",
  "detected_source_lang": "FR",
  "cached": false  // true si la traduction a été servie depuis le cache
}
```

Le frontend appelle cet endpoint, jamais DeepL directement. Cela permet de centraliser le logging, la gestion d'erreur et le cache.

### 10.4.3 Cache des traductions

Les traductions sont mises en cache pour éviter des appels DeepL répétés sur les mêmes contenus. Le cache est implicitement porté par le stockage des champs multilingues dans la base : une fois la traduction stockée dans `products.description_marketing.en`, elle est réutilisée tant que la version FR ne change pas.

Pas de cache applicatif Redis ou mémoire en MVP1. La base est l'unique source de vérité.

### 10.4.4 Gestion des erreurs

- **Quota DeepL dépassé** : le service retourne 456 Quota Exceeded. La plateforme affiche « Quota de traduction dépassé » à l'utilisateur, propose de saisir manuellement.
- **API DeepL indisponible** : timeout 10s. Retry 2 fois, puis échec avec message « Service de traduction temporairement indisponible ».
- **Texte source vide ou trop long** (>5000 caractères) : validation côté backend avant appel DeepL.
- **Erreur d'authentification** : log + alerte email à `yassine@boldys.ai` et `karim@boldys.ai`.

## 10.5 Génération des offres dans une langue cible

Quand une offre (tarifaire ou projet) est générée dans une langue cible (`offers.language`), la plateforme assemble le contenu multilingue selon les règles suivantes.

### 10.5.1 Résolution des contenus produits

Pour chaque produit de l'offre, la version dans la langue cible est utilisée si elle existe. **Fallback explicite vers la version FR** si la version cible est absente ou vide.

Pseudo-code :

```python
def resolve_product_description(
    product: Product,
    target_lang: str,
    field: str  # 'description_marketing' ou 'description_technical'
) -> tuple[str, bool]:
    """Retourne (texte, fallback_used)."""
    descriptions = getattr(product, field) or {}
    if target_lang in descriptions and descriptions[target_lang]:
        return descriptions[target_lang], False
    # Fallback FR
    if 'fr' in descriptions and descriptions['fr']:
        return descriptions['fr'], True
    return "", False
```

Le flag `fallback_used` est tracé dans le logging de la génération : Olivier peut consulter la liste des produits qui ont été sortis en FR alors que l'offre était demandée en EN ou ES, et décider s'il traduit ces produits avant nouvelle génération.

### 10.5.2 Résolution des documents joints

Les documents de la bibliothèque (cf. §7.4) ont une clé `language` indiquant la langue du fichier. Pour une offre en EN :

- Si une version EN du document existe : utilisée
- Sinon, fallback sur la version FR
- Si aucune version FR n'existe non plus (cas atypique), le document est exclu de l'offre avec un warning

### 10.5.3 Génération de copy contextuelle

Les textes générés par OpenAI (introduction, reformulation du besoin, contraintes client, alternatives) sont produits **directement dans la langue cible** via le prompt envoyé à OpenAI (« Generate the executive summary in English », « Genera el resumen ejecutivo en español », etc.).

Gamma génère le devis dans la langue indiquée en paramètre de l'API call. La structure des 5 sections (cf. §7.3.4) est invariante linguistiquement, seul le texte change.

### 10.5.4 Libellés structurels du document

Les libellés structurels (« Bill of Materials », « Project Organization », « Validité de l'offre », etc.) sont intégrés aux templates Gamma. Comme ces templates sont stockés côté Syskern et modifiables par eux (cf. §7.7.2), la responsabilité de la traduction des libellés structurels du devis Gamma est côté client.

Pour le format Excel, les en-têtes de colonnes sont traduits côté plateforme via un dictionnaire interne FR/EN/ES dans le code.

## 10.6 Coûts d'abonnement aux services de traduction

Conformément à l'article 8.2 du contrat-cadre, les coûts d'abonnement aux Outils Tiers nécessaires au fonctionnement de la solution (DeepL, OpenAI) sont **à la charge du client**.

Deux configurations possibles :

- **Avec contrat de maintenance Boldys** : les abonnements DeepL et OpenAI sont inclus dans le forfait de maintenance, Boldys opère les comptes et refacture le coût au client (modalités détaillées dans le contrat de maintenance).
- **Sans contrat de maintenance** : le client souscrit directement ses propres abonnements DeepL et OpenAI, fournit les clés API à la plateforme via les variables d'environnement `DEEPL_API_KEY` et `OPENAI_API_KEY`.

Dans les deux cas, l'usage des services est dimensionné par les actions de l'utilisateur (traductions à la demande, générations de copy IA pour les offres).

## 10.7 Interface utilisateur — éléments visibles du multilingue

### 10.7.1 Dans la fiche produit

Les champs multilingues sont rendus comme un groupe d'inputs avec un sélecteur de langue actif :

```jsx
┌─────────────────────────────────────────────┐
│ Description marketing                          │
│ [FR] [EN] [ES]                  [Traduire]    │
│ ┌─────────────────────────────────────────┐  │
│ │ Câble catégorie 7 blindé, conforme aux norm… │  │
│ │                                            │  │
│ └─────────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

L'onglet de langue actif est matérialisé. Les onglets non remplis affichent un point d'alerte discret. Le bouton « Traduire » agit sur l'onglet actif (traduction depuis le FR vers la langue active).

### 10.7.2 Dans la liste catalogue

Les descriptions affichées dans la liste sont en FR. Pas de switch de langue dans la vue catalogue. La gestion linguistique se fait uniquement dans la fiche produit.

### 10.7.3 Indicateur de couverture multilingue

Une colonne optionnelle dans la vue catalogue affiche un indicateur de couverture : « FR » seul, « FR EN », « FR ES », « FR EN ES ». Cela permet à Olivier d'identifier rapidement les produits non encore traduits avant un export en langue étrangère.

Filtre disponible : « Produits non traduits en EN », « Produits non traduits en ES ». Action bulk « Traduire la sélection » directement applicable.

## 10.8 Synthèse des décisions multilingues

| Aspect | Décision MVP1 |
| --- | --- |
| Langues supportées | FR / EN / ES (PL retiré vs annexe préliminaire) |
| Interface utilisateur | FR uniquement |
| Contenus produits | JSONB FR/EN/ES, FR obligatoire |
| Service de traduction | DeepL exclusivement |
| Traduction de masse à la migration | Non, traduction à la demande uniquement |
| Déclencheurs de traduction auto | Champ, produit, ou sélection bulk — toujours par action utilisateur |
| Invalidation des traductions | Non automatique, indicateur visuel uniquement |
| Fallback en génération d'offre | Vers FR si langue cible absente |
| Coût DeepL / OpenAI | À la charge du client (article 8.2 contrat-cadre), optionnellement inclus dans contrat de maintenance |

---

# 11. Hors scope MVP1

Cette section consolide l'ensemble des fonctionnalités, comportements et engagements explicitement exclus du périmètre MVP1. Elle complète la section 4 « Exclusions explicites » de l'annexe préliminaire et sert de référence en cas de discussion sur la conformité du livrable.

La règle générale du contrat-cadre s'applique : toute fonctionnalité ou prestation non explicitement décrite dans l'annexe technique est exclue du périmètre. Cette section n'est pas exhaustive : elle liste les exclusions structurantes susceptibles de générer des incompréhensions, sans prétendre couvrir l'intégralité du non-périmètre.

## 11.1 Reporté à MVP2

**Médias et assets produits**

- Upload, stockage et affichage de fichiers attachés aux produits (photos HD, PDFs techniques, certifications, fiches techniques, DOP)
- Galeries d'images dans la fiche produit
- Catalogue tarifé avec visuels produits (le catalogue tarifé MVP1 est en texte structuré uniquement)
- Fiches techniques liées aux produits (mentionné par Olivier comme acceptable d'attendre)

La structure de la base de données est prête à accueillir ces médias dès le MVP1, mais aucun écran ni endpoint ne permet de les manipuler.

**Dashboard analytique**

- KPIs commerciaux avancés
- Graphiques d'évolution du cours du cuivre et des taux de change
- Analyse de la marge moyenne par gamme, par client, par période
- Visualisations comparatives au-delà de la comparaison de simulations (cf. §6.9.8)

**Audit trail métier**

- Historique « qui a fait quoi » sur les produits, simulations, offres
- Journal d'activité consultable depuis l'UI
- Conséquence directe de l'absence de gestion d'utilisateurs en MVP1 (cf. §11.3)

**Analyse concurrentielle**

- Saisie de prix concurrents par SKU
- Comparaison visuelle des positionnements de prix
- Alertes sur écarts de prix vs marché

**Analyse de rotation des stocks**

- Calcul de la vitesse de rotation
- Recommandations de réapprovisionnement basées sur l'historique

**Versioning des documents de la bibliothèque**

- Historique des versions d'un même document fixe
- Une version remplace simplement la précédente en MVP1 (cf. §7.4.3)

**Centralisation externe des logs**

- Pas de Datadog, Loki, ELK, ou équivalent
- Logs locaux sur le VPS avec rotation logrotate uniquement

## 11.2 Reporté à MVP3

**APIs externes automatisées**

- Récupération automatique du cours du cuivre LME / SHE
- Récupération automatique des taux de change EUR / USD / RMB
- En MVP1, ces valeurs sont saisies manuellement par l'utilisateur (cf. §6.3.1 et §6.3.2)

**Validation IA des prix**

- Détection automatique d'anomalies dans les prix calculés
- Alertes sur prix aberrants
- Suggestions de correction

**Suggestions IA de marges par Machine Learning**

- Modèle prédictif de marge optimale en fonction du segment client, du produit, de l'historique
- En MVP1, la marge est saisie manuellement avec une valeur par défaut globale

**Gestion multi-utilisateurs avec rôles**

- Comptes utilisateurs distincts (Olivier, Paul, Massinissa…)
- Rôles et permissions différenciés (admin, vendeur, lecture seule)
- Workflows de validation (création produit qui nécessite validation, génération d'offre qui nécessite approbation)
- En MVP1, mot de passe unique partagé sans notion d'utilisateur (cf. §9.1.2)

## 11.3 Décisions techniques d'exclusion MVP1

Fonctionnalités ou comportements activement écartés du MVP1 par décision d'architecture, sans report explicite vers une version ultérieure :

**Outil d'import Excel ré-utilisable**

- La migration des données initiales est une opération one-shot opérée par Boldys (cf. §8)
- Aucune interface utilisateur ne permet à Olivier d'importer un Excel après livraison
- Les ajouts de produits passent par la création manuelle dans l'interface ou par la sync Odoo

**Push automatique des prix vers Odoo**

- Les prix calculés (PV) ne sont pas écrits automatiquement dans Odoo
- L'export se fait manuellement via fichier Excel généré par la plateforme (cf. §5.3 et §7.2.3)

**Stratégie de fallback CSV pour la sync Odoo**

- Mentionnée dans l'annexe préliminaire mais retirée en MVP1
- En cas d'indisponibilité prolongée de l'API Odoo, la plateforme reste utilisable avec les données du dernier sync réussi, sans bascule automatique sur un import CSV (cf. §5.5)

**Recalcul automatique des simulations**

- Aucun recalcul ne s'effectue en arrière-plan (changement de cours du cuivre, sync Odoo, modification de produit)
- Le recalcul est exclusivement déclenché par l'utilisateur via le bouton « Recalculer » (cf. §6.9.4)

**Modale de confirmation systématique**

- Pas de modale de confirmation à chaque modification de paramètre dans une simulation
- Le pattern est « dirty + recalcul manuel », pas « confirmation à chaque clic » (cf. §6.9.4)

**Outil de réparation des lignes en quarantaine**

- Pas d'UI pour ré-injecter automatiquement une ligne de la table `migration_unmatched` après correction
- Si Olivier identifie un produit à créer depuis une ligne en quarantaine, il le crée manuellement et marque la ligne comme résolue (cf. §8.7)

**Interface utilisateur multilingue**

- L'UI est exclusivement en français en MVP1 (cf. §10.1)
- Le multilingue concerne uniquement les contenus produits et les sorties commerciales

**Traduction automatique de masse à la migration**

- Aucune traduction automatique des descriptions produits n'est exécutée à la migration
- Olivier déclenche les traductions à la demande, produit par produit ou par sélection bulk (cf. §10.3.4)

**Invalidation automatique des traductions**

- Modifier la version FR d'un champ multilingue n'invalide pas les versions EN et ES
- Indicateur visuel uniquement, à charge de l'utilisateur de retraduire si pertinent (cf. §10.3.3)

**Authentification avancée**

- Pas de SSO (Google, Microsoft, etc.)
- Pas d'authentification à deux facteurs (2FA / MFA)
- Pas de récupération de mot de passe par email
- Pas de magic link

**Chiffrement custom au repos**

- Pas de chiffrement applicatif au-delà du chiffrement disque natif du VPS et du chiffrement S3 standard (cf. §9.5)

**Tests de restauration périodiques**

- Pas de test périodique de restauration des backups
- Le runbook de restauration est documenté et opérationnel, mais aucun engagement de test régulier n'est pris en MVP1

**Métriques applicatives détaillées**

- Pas de monitoring CPU / RAM / latences par endpoint
- Pas de dashboard d'observabilité applicative
- Uniquement healthcheck + uptime externe (cf. §9.6.5)

**Notifications push ou email métier**

- Aucune notification automatique vers les utilisateurs Syskern (changement de statut d'offre, alerte de prix, expiration de tarif…)
- Les alertes d'expiration des offres sont visibles dans le dashboard interne uniquement (cf. §7.5.4)
- Les notifications email sont réservées aux alertes techniques internes Boldys (échec backup, downtime)

## 11.4 Hors scope général

Reprise des exclusions de l'article 4 de l'annexe préliminaire, applicables sauf mention explicite contraire dans la présente annexe technique :

- Maintenance évolutive et corrective post-garantie (couverte par contrat de maintenance séparé)
- Optimisation SEO de la plateforme
- Création de contenus marketing, rédactionnels ou visuels
- Formation des utilisateurs au-delà de ce qui est explicitement prévu dans l'annexe technique
- Migration de la solution vers une infrastructure tierce (autre que celle prévue : VPS OVH)
- Gestion des comptes et abonnements aux Outils Tiers (Odoo, Gamma, DeepL, OpenAI, Supabase) — à la charge du client sauf prise en charge dans le contrat de maintenance
- Toute fonctionnalité ou prestation non explicitement décrite dans la présente annexe technique

## 11.5 Extensions futures hors MVP

Mentions de vision long terme évoquées en kickoff mais hors de tout MVP planifié :

- Extension de l'usine Turquie (mentionnée dans l'annexe préliminaire en post-MVP3)
- Génération automatique de fiches techniques produit
- Module IA de traitement d'images (détourage automatique, redimensionnement, génération de visuels)
- Ouverture de la plateforme à des subsidiaires Syskern dans d'autres pays avec gestion fine des langues et devises locales
- Intégration avec d'autres systèmes du SI Syskern (CRM, comptabilité, logistique tierce)

Ces éléments sont mentionnés uniquement à titre d'information sur la trajectoire produit envisagée. Aucun engagement contractuel n'est pris à leur sujet en MVP1.

---

# 12. Annexes

## 12.1 Glossaire métier

Définitions consolidées des termes spécifiques au domaine pricing Syskern utilisés dans ce document.

### Prix et coûts

**PO (Purchase Order)**

Prix d'achat fournisseur de référence, exprimé dans la devise d'origine (RMB, USD, ou EUR). Peut être un prix net ou un prix de base indexé sur le cours du cuivre.

**PO base**

Prix d'achat de base saisi dans la fiche fournisseur (`product_suppliers.po_base_price`), correspondant à un cours de cuivre de référence (`product_suppliers.copper_base_price`).

**PO net**

PO recalculé avec le cours du cuivre actuel (cf. §6.3.1). Toujours en devise d'origine. Pour un produit non indexé cuivre, PO net = PO base.

**PA (Prix d'Achat)**

Prix d'achat global Syskern, intégrant le PO net, les transports, la douane et la marge Symea.

**PA net**

PA après application de tous les modules de calcul de la chaîne PA (cf. §6.4). Exprimé en EUR (devise pivot).

**PAMP (Prix d'Achat Moyen Pondéré)**

Moyenne pondérée des prix des unités en stock, calculée par Odoo (`standard_price`). Sert de prix de revient quand on vend depuis le stock existant.

**PAMP prévisionnel**

Projection du PAMP futur en intégrant les achats engagés et les ventes engagées. Calculé par la plateforme (cf. §6.7.1). Permet d'anticiper l'évolution du coût moyen.

**PR (Prix de Revient)**

Prix de revient utilisé comme base du calcul du PV. Combinaison du PA net et du PAMP prévisionnel via le mix stock/achat.

**PV (Prix de Vente)**

Prix final proposé au client, dans la devise et l'incoterm de vente. Résultat de la chaîne PV (cf. §6.8).

**Mix stock/achat**

Pourcentage du PR provenant du stock (PAMP) vs. du nouveau PA. Curseur de 0 à 100. À 0%, le PR est calculé uniquement sur le nouveau PA. À 100%, uniquement sur le PAMP prévisionnel. Dropshipping = mix à 0%.

### Marges

**Marge Symea**

Marge interne du groupe Symea, appliquée dans la chaîne PA. Par défaut 6%. Diviseur dans la formule (`PA = X / (1 - marge)`).

**Marge Syskern**

Marge commerciale appliquée dans la chaîne PV. Par défaut 20%. Réglable globalement, par gamme, ou par article.

### Cuivre

**Cours cuivre LME**

London Metal Exchange. Bourse de référence pour le cours du cuivre côté Europe.

**Cours cuivre SHE (SHFE)**

Shanghai Futures Exchange. Bourse de référence pour le cours du cuivre côté Chine.

**Indexation cuivre**

Mécanisme par lequel le prix d'un produit varie en fonction du cours du cuivre. S'applique aux produits contenant du cuivre (câbles principalement). Identifié par `is_copper_indexed = true`.

**Variation cuivre**

Différence entre le cours actuel et le cours de référence du PO, multipliée par le poids cuivre du produit. Formule : `(cours_actuel - cours_base) × poids_cuivre / 1000`.

**Poids cuivre**

Quantité de cuivre dans une unité du produit, exprimée en kg/unité (kg/km pour les câbles). Stocké dans `products.copper_weight_kg_per_unit`.

### Identifiants produit

**SKU (Stock Keeping Unit)**

Référence commerciale unique d'un produit. Format Syskern : code alphanumérique (ex: `KCFF6A4PZHDBL5-21`). Stocké dans `products.sku_code`.

**Item code**

Code alphanumérique généré automatiquement par Odoo à partir de la marque + catégorie. Utilisé en interne dans Odoo. Stocké dans `products.item_code`.

**Parent reference (référence générique)**

Référence partagée par plusieurs SKU déclinés (longueurs, couleurs). Optionnelle. Permet de regrouper des SKU pour la documentation (fiche technique, catalogue). Stockée dans `products.parent_reference`.

**Factory code (code usine)**

Code identifiant la source/usine du produit. Suffixe du SKU au format `-NN` ou `-ENN` (ex: `-21`, `-E02`). Stocké dans `products.factory_code`.

**HS Code**

Code douanier international (Harmonized System) utilisé pour la classification des marchandises à l'export.

**GTIN**

Global Trade Item Number. Code-barres standard (EAN-13 généralement).

### Hiérarchie produit

Hiérarchie à 4 niveaux utilisée par Syskern (cf. §3.2 et §4.2) :

- **Univers** : niveau le plus haut (ex: Tube, Rack, Fibre optique)
- **Famille** : sous-catégorie de l'univers (ex: Câbles réseau, Câbles industriels)
- **Gamme** : ligne de produits cohérente (ex: Catégorie 7, Catégorie 6a)
- **Sous-gamme** : déclinaison spécifique (ex: Câble blindé, Câble non blindé)

### Marques Syskern

- **Unicorn** : marque produit Syskern haut de gamme
- **NextCorn** : marque produit Syskern intermédiaire
- **OEM** : produits sourcés en marque blanche pour des clients tiers

### Contexte commercial

**Symea**

Groupe parent. Achète les produits aux usines (essentiellement en Chine). Marge Symea = 6% par défaut.

**Syskern**

Filiale commerciale du groupe Symea. Vend les produits aux clients finaux (distributeurs, intégrateurs, projets directs). Marge Syskern = 20% par défaut.

**Amplify Invest**

Entité contractuelle (SARL Luxembourg) signataire du contrat avec Boldys. Filiale de Syskern.

**Unikkern**

Marque commerciale Syskern utilisée dans les communications client.

## 12.2 Liste des incoterms

Incoterms 2020 supportés par la plateforme (pré-chargés en base au déploiement initial).

| Code | Libellé complet | Description courte | Impact chaîne de calcul |
| --- | --- | --- | --- |
| EXW | Ex Works | Le vendeur met les biens à disposition à ses locaux. L'acheteur prend en charge tout le transport. | Aucun transport ajouté côté vendeur |
| FCA | Free Carrier | Le vendeur livre au transporteur désigné par l'acheteur, à un lieu convenu. | Transport jusqu'au point de remise au transporteur |
| FAS | Free Alongside Ship | Le vendeur livre les biens le long du navire au port d'embarquement. | Transport jusqu'au port d'embarquement (maritime uniquement) |
| FOB | Free On Board | Le vendeur livre les biens à bord du navire au port d'embarquement. | Transport jusqu'au chargement à bord (maritime uniquement) |
| CFR | Cost and Freight | Le vendeur paie le fret jusqu'au port de destination, mais le risque transfère à l'embarquement. | Transport principal inclus jusqu'au port de destination |
| CIF | Cost, Insurance and Freight | Comme CFR plus l'assurance jusqu'au port de destination. | Transport principal + assurance inclus |
| CPT | Carriage Paid To | Le vendeur paie le transport jusqu'à la destination convenue. Transfert de risque au premier transporteur. | Transport principal inclus, multimodal |
| CIP | Carriage and Insurance Paid To | Comme CPT plus l'assurance. | Transport principal + assurance inclus, multimodal |
| DAP | Delivered At Place | Le vendeur livre les biens à la destination convenue, prêts à être déchargés. Acheteur gère la douane import. | Transport jusqu'à destination, sans douane import |
| DPU | Delivered at Place Unloaded | Comme DAP mais le vendeur décharge les biens à destination. | Transport jusqu'à destination + déchargement |
| DDP | Delivered Duty Paid | Le vendeur livre à destination, douane import incluse. Engagement maximal du vendeur. | Transport + douane import inclus |

## 12.3 Modes de transport et capacités par défaut

Modes de transport pré-chargés dans la table `transport_modes` au déploiement initial. Les capacités palette par défaut sont modifiables au cas par cas dans une simulation (cf. §6.3.3).

| Code | Libellé | Catégorie | Capacité palette par défaut | Notes |
| --- | --- | --- | --- | --- |
| 40HQ | Conteneur maritime 40' High Cube | maritime | 40 palettes | Standard pour les flux Asie → Europe |
| 40FT | Conteneur maritime 40' standard | maritime | 40 palettes | Volume utile inférieur au 40HQ |
| 20FT | Conteneur maritime 20' | maritime | 22 palettes | Pour les expéditions plus petites |
| TRUCK_FULL | Camion complet | road | 33 palettes | Tracteur + semi-remorque standard européen |
| TRUCK_LCL | Camion groupé | road | Saisie manuelle | Less Container Load routier |
| AIR_FREIGHT | Fret aérien | air | Saisie manuelle | Pour produits urgents ou de haute valeur |
| EXPRESS | Service express (UPS, DHL, FedEx) | air | Saisie manuelle | Pour échantillons ou pièces unitaires |

## 12.4 Récapitulatif des exemples de calcul

Index des exemples chiffrés présents dans le CDC.

| Référence | Section | Description | Résultat clé |
| --- | --- | --- | --- |
| Exemple chaîne PA complète | §6.4 | Câble cuivre-indexé, PO 2 350 RMB/km, transports maritime + routier, marge Symea 6% | **PA net = 390.1636 €/km** |
| Exemple chaîne PV simple | §6.8.4 | Reprise de l'exemple §6.4, mix stock/achat 0%, marge Syskern 20%, vente EXW | **PV = 487.7045 €/km** |

Ces deux exemples doivent être reproduits exactement par les tests unitaires du moteur de calcul (cf. §6.5 sur la précision numérique).

## 12.5 Conventions de nommage et formats

Récapitulatif des règles de validation et conventions techniques utilisées dans la plateforme.

### Identifiants produit

- **SKU** : `^[A-Z0-9-]+$`, max 64 caractères, unique
- **Code attribut** (registry) : `^[a-z][a-z0-9_]*$`, max 64 caractères, unique, immuable après création
- **Factory code** : extrait par regex depuis le suffixe SKU. Patterns reconnus : `-NN` (ex: `-21`), `-ENN` (ex: `-E02`)
- **Parent reference** : préfixe SKU avant le suffixe `-XX`. Exemple : `KCFF6A4PZHDBL5-21` → parent_reference = `KCFF6A4PZHDBL5`

### Devises et nombres

- **Devises supportées** : EUR, USD, RMB (codes ISO 4217)
- **Devise pivot interne** : EUR
- **Stockage des prix** : `NUMERIC(12,4)` en BDD (4 décimales)
- **Affichage des prix** : 2 décimales par défaut, 4 décimales pour les taux et coefficients
- **Méthode d'arrondi** : `ROUND_HALF_UP` (arrondi commercial standard)
- **Calculs internes** : `Decimal` Python (pas `float`) pour éviter les erreurs d'arrondi flottant
- **Convention FX** : tous les taux saisis depuis EUR (`fx_eur_rmb`, `fx_eur_usd`). Les taux entre devises non-EUR sont dérivés automatiquement.

### Dates et timestamps

- **Format date** : `YYYY-MM-DD` (ISO 8601)
- **Format datetime** : `YYYY-MM-DDTHH:MM:SSZ` (ISO 8601 UTC)
- **Fuseau de stockage** : UTC en base, conversion à l'affichage selon la locale utilisateur
- **Fuseau d'affichage par défaut** : Europe/Paris

### Langues

- **Codes langue** : ISO 639-1 (`fr`, `en`, `es`)
- **Stockage multilingue** : JSONB avec une clé par langue (cf. §10.2)
- **Langue de référence** : FR (obligatoire pour tout contenu multilingue)

### Validation produit

- **`name`** : obligatoire, max 255 caractères
- **`description_marketing.fr`** : obligatoire, max 5000 caractères
- **`copper_weight_kg_per_unit`** : > 0 si `is_copper_indexed = true`
- **`po_base_price`** : > 0 sur un fournisseur actif
- **`margin_rate`** : 0 ≤ rate < 1 (un taux ≥ 1 rendrait la division impossible)
- **`mix_pct`** : entier entre 0 et 100

## 12.6 Index des décisions structurantes

Liste consolidée des décisions architecturales marquées 📌 dans le document, pour référence rapide.

| Décision | Section |
| --- | --- |
| Couche d'abstraction Odoo unique, dual v16/v19 via factory | §2.3, §5.1 |
| Pattern EAV avec valeurs JSONB pour les attributs dynamiques | §3.2 (`attribute_registry`) |
| Snapshot complet à chaque simulation pour cohérence historique | §3.2 (`simulation_lines`) |
| Attributs dynamiques non poussés vers Odoo | §5.3 |
| Chaîne de calcul modulaire avec drag-and-drop côté UI | §6.2 |
| Calculs en `Decimal` Python, pas `float`, ROUND_HALF_UP | §6.5 |
| Recalcul exclusivement manuel, pattern dirty + bouton Recalculer | §6.9.4 |
| Historique figé des recalculs dans `simulation_recalculations` | §6.9.12 |
| DeepL pour traduction, OpenAI pour génération de copy | §7.6.2, §10.4 |
| Templates Gamma stockés côté Syskern, modifiables par le client | §7.7.2 |
| Migration one-shot par scripts dédiés par fichier source | §8.4 |
| Auth Supabase native self-hosted, compte unique partagé | §9.1.1 |
| Backup quotidien Postgres + Storage vers S3, rétention 7j | §9.4.2 |
| UI mono-langue FR, multilingue limité aux contenus produits | §10.1 |
| Traduction à la demande uniquement, pas de traduction de masse | §10.3.2 |

---

*Fin du cahier des charges technique MVP1.*

```

```
