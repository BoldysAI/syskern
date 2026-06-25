"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import {
  ArrowLeft,
  Clock,
  DownloadSimple,
  ArrowSquareOut,
  GitBranch,
  CircleNotch,
  PaperPlaneTilt,
  ThumbsDown,
  Trophy,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge, offerStatusVariant } from "@/components/StatusBadge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { FormField } from "@/components/FormField";
import {
  useBreadcrumbOverride,
  type BreadcrumbCrumb,
} from "@/components/layout/BreadcrumbContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ── Types ────────────────────────────────────────────────────────────────────

interface OfferLine {
  id: string;
  product_sku: string;
  product_name: string;
  final_price: string;
  quantity: string | null;
  display_order: number;
}
interface OfferDetail {
  id: string;
  label: string;
  offer_type: "tariff" | "project";
  status: string;
  currency: string;
  language: string;
  project_name: string;
  client_ids: string[];
  version_number: number;
  valid_to: string | null;
  simulation: string;
  generation_status: string;
  generated_file_url: string;
  generation_error: string;
  project_info: Record<string, unknown>;
  lines: OfferLine[];
}
interface VersionRow {
  id: string;
  version_number: number;
  status: string;
}
interface ClientLite {
  id: string;
  name: string;
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  sent: "Envoyée",
  won: "Gagnée",
  lost: "Perdue",
  expired: "Expirée",
};

function getCsrfToken(): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(/csrftoken=([^;]+)/);
  return m ? m[1] : "";
}
async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error("Erreur de chargement");
  return res.json();
}
async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d?.detail ?? "Erreur serveur");
  }
  return res.json();
}
async function patchStatus(id: string, status: string) {
  const res = await fetch(`/api/offers/${id}/status/`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d?.detail ?? "Transition refusée");
  }
}

function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const ms = new Date(date).getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function OfferDetailPage() {
  const id = String(useParams().id);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extendOpen, setExtendOpen] = useState(false);
  const [extendDate, setExtendDate] = useState("");

  const { data: offer, mutate, isLoading } = useSWR<OfferDetail>(`offer:${id}`, () =>
    getJson<OfferDetail>(`/api/offers/${id}/`),
  );
  const { data: versions } = useSWR<VersionRow[]>(
    offer?.offer_type === "project" ? `offer-versions:${id}` : null,
    () => getJson<VersionRow[]>(`/api/offers/${id}/versions/`),
  );
  const { data: clientsResp } = useSWR("clients:all", () =>
    getJson<{ results?: ClientLite[] } | ClientLite[]>("/api/clients/?limit=1000"),
  );
  const clientName = (() => {
    const list = Array.isArray(clientsResp) ? clientsResp : (clientsResp?.results ?? []);
    const map = new Map(list.map((c) => [c.id, c.name]));
    return (offer?.client_ids ?? []).map((i) => map.get(i) ?? "—").join(", ") || "—";
  })();

  const breadcrumbCrumbs = useMemo((): BreadcrumbCrumb[] | null => {
    if (!offer) return null;
    return [
      { href: "/", label: "Tableau de bord" },
      { href: "/offers", label: "Offres" },
      { label: offer.label },
    ];
  }, [offer]);

  useBreadcrumbOverride(breadcrumbCrumbs, Boolean(offer));

  if (isLoading || !offer) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 p-6">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-8 w-2/3" />
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const isProject = offer.offer_type === "project";
  const remaining = daysUntil(offer.valid_to);
  const total = offer.lines.reduce(
    (sum, l) => sum + Number(l.final_price) * (l.quantity ? Number(l.quantity) : 1),
    0,
  );

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await mutate();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  const newVersion = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await postJson<{ id: string }>(`/api/offers/${id}/new-version/`);
      router.push(`/offers/${created.id}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erreur");
      setBusy(false);
    }
  };

  const extend = async () => {
    if (!extendDate) return;
    await run(async () => {
      await postJson(`/api/offers/${id}/extend-expiration/`, { new_date: extendDate });
      setExtendOpen(false);
    });
  };

  return (
    <div className="mx-auto max-w-4xl p-6">
      <Link
        href="/offers"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={15} />
        Offres
      </Link>

      <PageHeader
        title={offer.project_name || offer.label}
        description={`${clientName} · ${offer.currency} · ${offer.language.toUpperCase()}`}
        meta={
          <>
            <StatusBadge variant={offerStatusVariant(offer.status)}>
              {STATUS_LABELS[offer.status] ?? offer.status}
            </StatusBadge>
            <StatusBadge variant={isProject ? "info" : "running"}>
              {isProject ? "Projet" : "Tarif"} · V{offer.version_number}
            </StatusBadge>
          </>
        }
      />

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Info cards */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Info label="Simulation source">
          <Link href={`/simulator/${offer.simulation}`} className="text-warm hover:underline">
            Ouvrir
          </Link>
        </Info>
        <Info label="Expiration">
          {offer.valid_to ? (
            <span
              className={cn(
                "inline-flex items-center gap-1.5",
                remaining != null && remaining <= 7 ? "text-warm" : "text-foreground",
              )}
            >
              <Clock size={14} />
              {new Date(offer.valid_to).toLocaleDateString("fr-FR")}
              {remaining != null && (
                <span className="text-xs">
                  ({remaining < 0 ? "expirée" : `dans ${remaining} j`})
                </span>
              )}
            </span>
          ) : (
            "—"
          )}
        </Info>
        <Info label="Total estimé">
          <span className="font-data">
            {total.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} {offer.currency}
          </span>
        </Info>
      </div>

      {/* Files */}
      <Card className="mb-5 p-4">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Document</h2>
        {isProject ? (
          offer.generation_status === "ready" && offer.generated_file_url ? (
            <a
              href={offer.generated_file_url}
              target="_blank"
              rel="noreferrer"
              className={cn(buttonVariants(), "inline-flex gap-2")}
            >
              Ouvrir le devis Gamma
              <ArrowSquareOut size={14} weight="duotone" />
            </a>
          ) : offer.generation_status === "error" ? (
            <span className="text-sm text-destructive">
              Génération en erreur : {offer.generation_error}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <CircleNotch size={14} className="animate-spin" />
              Génération en cours…
            </span>
          )
        ) : (
          <a href={`/api/offers/${id}/download/`} className={cn(buttonVariants(), "inline-flex gap-2")}>
            <DownloadSimple size={14} weight="duotone" />
            Télécharger l&apos;Excel
          </a>
        )}
      </Card>

      {/* Version chain */}
      {isProject && versions && versions.length > 1 && (
        <Card className="mb-5 p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <GitBranch size={15} />
            Versions
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {versions.map((v, i) => (
              <span key={v.id} className="flex items-center gap-2">
                <Link
                  href={`/offers/${v.id}`}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-sm",
                    v.id === offer.id
                      ? "border-primary bg-accent font-semibold text-accent-foreground"
                      : "border-border text-muted-foreground hover:bg-muted/50",
                  )}
                >
                  V{v.version_number}
                  <span className="ml-1.5 text-xs text-muted-foreground/70">
                    {STATUS_LABELS[v.status] ?? v.status}
                  </span>
                </Link>
                {i < versions.length - 1 && (
                  <span className="text-muted-foreground/40">→</span>
                )}
              </span>
            ))}
          </div>
        </Card>
      )}

      {/* Lines */}
      <Card className="mb-5 overflow-hidden py-0">
        <h2 className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">
          Lignes ({offer.lines.length})
        </h2>
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left">SKU</th>
              <th className="px-4 py-2 text-left">Désignation</th>
              {isProject && <th className="px-4 py-2 text-right">Qté</th>}
              <th className="px-4 py-2 text-right">PU ({offer.currency})</th>
              {isProject && <th className="px-4 py-2 text-right">Total</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {offer.lines.map((l) => (
              <tr key={l.id} className="hover:bg-muted/30">
                <td className="px-4 py-2 font-medium text-foreground">{l.product_sku}</td>
                <td className="px-4 py-2 text-muted-foreground">{l.product_name}</td>
                {isProject && (
                  <td className="px-4 py-2 text-right font-data">
                    {l.quantity ? Number(l.quantity) : "—"}
                  </td>
                )}
                <td className="px-4 py-2 text-right font-data">
                  {Number(l.final_price).toFixed(2)}
                </td>
                {isProject && (
                  <td className="px-4 py-2 text-right font-data">
                    {(Number(l.final_price) * (l.quantity ? Number(l.quantity) : 1)).toFixed(2)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Lifecycle actions */}
      <div className="flex flex-wrap gap-3">
        {offer.status === "draft" && (
          <Button onClick={() => run(() => patchStatus(id, "sent"))} disabled={busy}>
            <PaperPlaneTilt size={15} weight="duotone" />
            Marquer envoyée
          </Button>
        )}
        {isProject && offer.status === "sent" && (
          <>
            <Button
              variant="default"
              className="bg-brand-green hover:bg-brand-green/90"
              onClick={() => run(() => patchStatus(id, "won"))}
              disabled={busy}
            >
              <Trophy size={15} weight="duotone" />
              Gagnée
            </Button>
            <Button
              variant="destructive"
              onClick={() => run(() => patchStatus(id, "lost"))}
              disabled={busy}
            >
              <ThumbsDown size={15} weight="duotone" />
              Perdue
            </Button>
          </>
        )}
        <Button variant="outline" onClick={() => setExtendOpen(true)} disabled={busy}>
          <Clock size={15} />
          Prolonger l&apos;expiration
        </Button>
        {isProject && (
          <Button variant="outline" onClick={newVersion} disabled={busy}>
            <GitBranch size={15} />
            Nouvelle version
          </Button>
        )}
      </div>

      <Dialog open={extendOpen} onOpenChange={setExtendOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Prolonger l&apos;expiration</DialogTitle>
            <DialogDescription>
              Choisissez une nouvelle date d&apos;expiration (&gt; 7 jours).
            </DialogDescription>
          </DialogHeader>
          <FormField label="Nouvelle date" required>
            <Input
              type="date"
              value={extendDate}
              onChange={(e) => setExtendDate(e.target.value)}
            />
          </FormField>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExtendOpen(false)}>
              Annuler
            </Button>
            <Button onClick={extend} disabled={!extendDate || busy}>
              Valider
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card className="px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium text-foreground">{children}</div>
    </Card>
  );
}
