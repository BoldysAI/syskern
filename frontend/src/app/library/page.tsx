"use client";

import { useMemo, useRef, useState } from "react";
import useSWR, { mutate } from "swr";
import { Download, Eye, FileText, History, Plus, Trash2, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ConfirmProvider";
import { toast } from "sonner";

// ── Types ────────────────────────────────────────────────────────────────────

interface Doc {
  id: string;
  name: Record<string, string>;
  category: string;
  language: string;
  file_name: string;
  file_size_bytes: number | null;
  mime_type: string;
  version: number;
  product: string | null;
  product_sku: string | null;
  product_name: string | null;
  description: string;
  download_url: string;
  created_at: string;
}
interface Paginated<T> {
  count: number;
  results: T[];
}
interface ProductLite {
  id: string;
  sku_code: string;
  name: string;
}

const CATEGORIES: { code: string; label: string }[] = [
  { code: "cgv", label: "CGV" },
  { code: "warranty", label: "Garantie" },
  { code: "quality", label: "Qualité" },
  { code: "project_reference", label: "Références projet" },
  { code: "company", label: "Entreprise" },
  { code: "other", label: "Autre" },
];
const CAT_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.code, c.label]));
const LANGS = [
  { code: "", label: "Multi" },
  { code: "fr", label: "FR" },
  { code: "en", label: "EN" },
  { code: "es", label: "ES" },
];
const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED_EXT = [".pdf", ".jpg", ".jpeg", ".png", ".docx", ".xlsx"];

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
function humanSize(b: number | null): string {
  if (!b) return "—";
  if (b < 1024) return `${b} o`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} Ko`;
  return `${(b / 1024 / 1024).toFixed(1)} Mo`;
}
function docLabel(d: Doc): string {
  return d.name?.fr || d.name?.en || d.file_name || "—";
}

// ── Upload modal ──────────────────────────────────────────────────────────────

function UploadModal({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState("cgv");
  const [language, setLanguage] = useState("fr");
  const [productQuery, setProductQuery] = useState("");
  const [productId, setProductId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: productsResp } = useSWR("products:lite", () =>
    getJson<Paginated<ProductLite> | ProductLite[]>("/api/products/?limit=1000"),
  );
  const products = useMemo<ProductLite[]>(
    () => (Array.isArray(productsResp) ? productsResp : (productsResp?.results ?? [])),
    [productsResp],
  );
  const productMatches = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    if (!q || productId) return [];
    return products
      .filter((p) => p.sku_code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [productQuery, productId, products]);

  const validate = (f: File): string | null => {
    const ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) return "Format non accepté (PDF, JPG, PNG, DOCX, XLSX).";
    if (f.size > MAX_BYTES) return "Fichier trop volumineux (max 20 Mo).";
    return null;
  };
  const pickFile = (f: File | null) => {
    if (!f) return;
    const err = validate(f);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setFile(f);
  };

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("category", category);
      fd.append("language", language);
      if (productId) fd.append("product", productId);
      if (notes) fd.append("description", notes);
      fd.append("name", JSON.stringify({ fr: file.name }));
      const res = await fetch("/api/document-library/upload/", {
        method: "POST",
        credentials: "include",
        headers: { "X-CSRFToken": getCsrfToken() },
        body: fd,
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.detail ?? "Échec de l'upload.");
      }
      await mutate((k) => typeof k === "string" && k.startsWith("library:"));
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Échec de l'upload.");
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Ajouter un document</h2>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            pickFile(e.dataTransfer.files?.[0] ?? null);
          }}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "mb-4 flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center text-sm",
            dragOver ? "border-primary bg-accent" : "border-border text-slate-500",
          )}
        >
          <Upload size={22} className="text-slate-400" />
          {file ? (
            <span className="font-medium text-slate-700">
              {file.name} · {humanSize(file.size)}
            </span>
          ) : (
            <span>Glissez un fichier ici ou cliquez (PDF, JPG, PNG, DOCX, XLSX · max 20 Mo)</span>
          )}
          <input
            ref={inputRef}
            type="file"
            accept={ALLOWED_EXT.join(",")}
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Catégorie</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
            >
              {CATEGORIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Langue</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
            >
              {LANGS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="relative mt-3">
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Produit lié (optionnel)
          </label>
          <input
            value={productQuery}
            onChange={(e) => {
              setProductQuery(e.target.value);
              setProductId("");
            }}
            placeholder="Rechercher un SKU ou un nom…"
            className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          {productId && (
            <span className="mt-1 inline-block text-xs text-green-600">Produit lié ✓</span>
          )}
          {productMatches.length > 0 && (
            <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-white shadow-lg">
              {productMatches.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setProductId(p.id);
                    setProductQuery(`${p.sku_code} — ${p.name}`);
                  }}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                >
                  <span className="font-medium">{p.sku_code}</span>{" "}
                  <span className="text-slate-500">{p.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mt-3">
          <label className="mb-1 block text-xs font-medium text-slate-600">Notes</label>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        <div className="mt-5 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-border py-2.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            Annuler
          </button>
          <button
            onClick={submit}
            disabled={!file || busy}
            className="flex-1 rounded-lg bg-primary py-2.5 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "Envoi…" : "Uploader"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Preview + versions modals ──────────────────────────────────────────────────

function PreviewModal({ doc, onClose }: { doc: Doc; onClose: () => void }) {
  const isImage = doc.mime_type.startsWith("image/");
  const isPdf = doc.mime_type === "application/pdf";
  const src = `${doc.download_url}?inline=1`;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex h-[85vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <span className="truncate text-sm font-medium text-slate-800">{docLabel(doc)}</span>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>
        <div className="flex flex-1 items-center justify-center overflow-auto bg-slate-50 p-4">
          {isPdf ? (
            <iframe src={src} title={docLabel(doc)} className="h-full w-full rounded-lg border-0" />
          ) : isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={docLabel(doc)} className="max-h-full max-w-full object-contain" />
          ) : (
            <div className="text-center text-sm text-slate-500">
              <FileText size={40} className="mx-auto mb-2 text-slate-300" />
              Aperçu indisponible pour ce format.
              <a href={doc.download_url} className="mt-2 block font-medium text-warm">
                Télécharger
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function VersionsModal({ doc, onClose }: { doc: Doc; onClose: () => void }) {
  const { data } = useSWR<Doc[]>(`versions:${doc.id}`, () =>
    getJson<Doc[]>(`/api/document-library/${doc.id}/versions/`),
  );
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Versions — {doc.file_name}</h2>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>
        <div className="flex flex-col gap-1.5">
          {(data ?? []).map((v) => (
            <div
              key={v.id}
              className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
            >
              <span>
                <span className="font-medium">v{v.version}</span>{" "}
                <span className="text-slate-400">
                  · {new Date(v.created_at).toLocaleDateString("fr-FR")}
                </span>
              </span>
              <a href={v.download_url} className="text-xs font-medium text-warm">
                Télécharger
              </a>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LibraryPage() {
  const confirm = useConfirm();
  const [category, setCategory] = useState("");
  const [language, setLanguage] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [preview, setPreview] = useState<Doc | null>(null);
  const [versions, setVersions] = useState<Doc | null>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams({ limit: "200" });
    if (category) p.set("category", category);
    if (language) p.set("language", language);
    return p.toString();
  }, [category, language]);

  const { data, isLoading, error } = useSWR<Paginated<Doc>>(`library:${query}`, () =>
    getJson<Paginated<Doc>>(`/api/document-library/?${query}`),
  );
  const docs = data?.results ?? [];

  const remove = async (d: Doc) => {
    const ok = await confirm({
      title: "Supprimer le document",
      description: `Supprimer « ${docLabel(d)} » ? (conservé 30 jours puis purgé)`,
      confirmLabel: "Supprimer",
      destructive: true,
    });
    if (!ok) return;
    await fetch(`/api/document-library/${d.id}/`, {
      method: "DELETE",
      credentials: "include",
      headers: { "X-CSRFToken": getCsrfToken() },
    });
    mutate(`library:${query}`);
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Bibliothèque de documents</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Pièces jointes réutilisables pour les offres projet (CDC §7.4)
          </p>
        </div>
        <button
          onClick={() => setShowUpload(true)}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary/90"
        >
          <Plus size={16} /> Ajouter
        </button>
      </div>

      <div className="mb-4 flex gap-3">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-lg border border-border bg-white px-3 py-2 text-sm"
        >
          <option value="">Toutes catégories</option>
          {CATEGORIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </select>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="rounded-lg border border-border bg-white px-3 py-2 text-sm"
        >
          <option value="">Toutes langues</option>
          {LANGS.filter((l) => l.code).map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
        {error ? (
          <div className="py-16 text-center text-sm text-slate-400">Erreur de chargement.</div>
        ) : isLoading ? (
          <div className="py-16 text-center text-sm text-slate-400">Chargement…</div>
        ) : docs.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-20 text-slate-400">
            <FileText size={28} className="text-slate-300" />
            <p className="text-sm">Aucun document. Cliquez « Ajouter » pour en uploader un.</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="border-b border-border bg-background">
              <tr>
                {["Document", "Catégorie", "Langue", "Produit", "Ver.", "Taille", "Actions"].map(
                  (h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {docs.map((d) => (
                <tr key={d.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-slate-800">{docLabel(d)}</div>
                    <div className="text-xs text-slate-400">{d.file_name}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {CAT_LABEL[d.category] ?? d.category}
                  </td>
                  <td className="px-4 py-3 text-sm uppercase text-slate-500">
                    {d.language || "multi"}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">{d.product_sku ?? "—"}</td>
                  <td className="px-4 py-3 text-sm text-slate-500">v{d.version}</td>
                  <td className="px-4 py-3 text-sm text-slate-500">
                    {humanSize(d.file_size_bytes)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <IconBtn title="Aperçu" onClick={() => setPreview(d)}>
                        <Eye size={15} />
                      </IconBtn>
                      <a
                        href={d.download_url}
                        title="Télécharger"
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-accent/50 hover:text-warm"
                      >
                        <Download size={15} />
                      </a>
                      <IconBtn title="Versions" onClick={() => setVersions(d)}>
                        <History size={15} />
                      </IconBtn>
                      <IconBtn title="Supprimer" danger onClick={() => remove(d)}>
                        <Trash2 size={15} />
                      </IconBtn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showUpload && <UploadModal onClose={() => setShowUpload(false)} />}
      {preview && <PreviewModal doc={preview} onClose={() => setPreview(null)} />}
      {versions && <VersionsModal doc={versions} onClose={() => setVersions(null)} />}
    </div>
  );
}

function IconBtn({
  children,
  title,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={cn(
        "rounded-lg p-1.5 text-slate-400 transition-colors",
        danger ? "hover:bg-red-50 hover:text-red-500" : "hover:bg-accent/50 hover:text-warm",
      )}
    >
      {children}
    </button>
  );
}
