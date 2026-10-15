"use client";

import { useAuth } from "@/contexts/AuthContext";
import { uiDateLocale } from "@/lib/i18n";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR, { mutate as globalMutate } from "swr";
import {
  Pulse,
  ArrowsClockwise,
  CheckCircle,
  CircleDashed,
  CircleNotch,
  Coins,
  Database,
  Envelope,
  PencilSimple,
  Plus,
  Trash,
  Truck,
  Warning,
  XCircle,
} from "@phosphor-icons/react";
import SettingsNav, { SettingsNavFallback } from "./_components/SettingsNav";
import TabTransportPresets from "./_components/TabTransportPresets";
import { useRequireAdmin } from "@/hooks/useRequireAdmin";
import { useConfirm } from "@/components/ConfirmProvider";
import { toast } from "sonner";
import { AppModal } from "@/components/AppModal";
import { FormField } from "@/components/FormField";
import { AppIcon } from "@/components/AppIcon";
import { StatusBadge } from "@/components/StatusBadge";
import { OptionSelect } from "@/components/OptionSelect";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  listMarketParameters,
  createMarketParameter,
  updateMarketParameter,
  deleteMarketParameter,
  listTransportModes,
  createTransportMode,
  updateTransportMode,
  deleteTransportMode,
  listSyncLogs,
  getSyncStatus,
  getOdooHealth,
  triggerOdooSync,
  getOfferAlertSettings,
  updateOfferAlertSettings,
  type MarketParameter,
  type MarketParameterType,
  type TransportMode,
  type SyncLog,
  type SyncStatus,
  type OfferAlertSettings,
} from "@/lib/api";
import { useUiTranslate } from "@/lib/use-ui-translate";
import { cn } from "@/lib/utils";

const MARKET_CURRENCIES = [
  { value: "EUR", labelKey: "settings.currency.eur" },
  { value: "USD", labelKey: "settings.currency.usd" },
  { value: "RMB", labelKey: "settings.currency.rmb" },
] as const;

const COPPER_UNITS = [
  { value: "tonne", labelKey: "settings.market.unitTonne" },
  { value: "kg", labelKey: "settings.market.unitKg" },
] as const;

function normalizeCopperUnit(unit?: string | null): string {
  if (!unit || unit === "ton") return "tonne";
  return unit;
}

function formatFxRateDisplay(rate: string | null | undefined, locale: string): string {
  if (rate == null || rate === "") return "—";
  const n = parseFloat(rate);
  if (!Number.isFinite(n)) return rate;
  return n.toLocaleString(uiDateLocale(locale), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function sanitizeFxRateInput(raw: string, previous: string): string {
  if (raw === "") return "";
  const normalized = raw.replace(",", ".");
  if (/^\d*\.?\d{0,2}$/.test(normalized)) return normalized;
  return previous;
}

function formatMarketParamUpdatedAt(value: string | null | undefined, locale: string): string {
  if (!value) return "—";
  return new Date(value).toLocaleString(uiDateLocale(locale), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const COPPER_MARKETS = [
  { value: "LME", labelKey: "settings.market.lme" },
  { value: "SHE", labelKey: "settings.market.she" },
] as const;

const TRANSPORT_CATEGORIES = [
  { value: "maritime", labelKey: "settings.transport.category.maritime" },
  { value: "road", labelKey: "settings.transport.category.road" },
  { value: "air", labelKey: "settings.transport.category.air" },
  { value: "rail", labelKey: "settings.transport.category.rail" },
] as const;

const MARKET_COLUMN_KEYS = [
  "settings.type",
  "settings.market.column.detail",
  "settings.market.column.validFrom",
  "settings.market.column.to",
  "settings.market.column.updated",
  "settings.active",
  "",
] as const;

const TRANSPORT_COLUMN_KEYS = [
  "settings.code",
  "settings.label",
  "settings.category",
  "settings.transport.column.capacity",
  "settings.active",
  "",
] as const;

const ODOO_COLUMN_KEYS = [
  "settings.odoo.column.date",
  "settings.type",
  "settings.odoo.column.scope",
  "settings.odoo.column.status",
  "settings.odoo.column.created",
  "settings.odoo.column.updated",
  "settings.odoo.column.failed",
  "settings.odoo.column.triggeredBy",
] as const;

function copperUnitLabel(unit: string | null | undefined, t: ReturnType<typeof useUiTranslate>): string {
  const normalized = normalizeCopperUnit(unit);
  const match = COPPER_UNITS.find((u) => u.value === normalized);
  return match ? t(match.labelKey) : normalized;
}

function transportCategoryLabel(category: string, t: ReturnType<typeof useUiTranslate>): string {
  const match = TRANSPORT_CATEGORIES.find((c) => c.value === category);
  return match ? t(match.labelKey) : category;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function ActiveBadge({ active }: { active: boolean }) {
  const t = useUiTranslate();
  return (
    <StatusBadge variant={active ? "success" : "draft"}>
      {active ? t("common.yes") : t("common.no")}
    </StatusBadge>
  );
}

// ── Tab : Marché (Market parameters) ─────────────────────────────────────
function MarketParamModal({ param, onClose }: { param?: MarketParameter; onClose: () => void }) {
  const [type, setType] = useState<MarketParameterType>(param?.parameter_type ?? "copper_price");
  const [validFrom, setValidFrom] = useState(param?.valid_from ?? todayIso());
  const [validTo, setValidTo] = useState(param?.valid_to ?? "");
  const [isActive, setIsActive] = useState(param?.is_active ?? true);
  const [notes, setNotes] = useState(param?.notes ?? "");
  const [source, setSource] = useState(param?.source ?? "");
  const [copperMarket, setCopperMarket] = useState(param?.copper_market ?? "LME");
  const [copperPrice, setCopperPrice] = useState(param?.copper_price ?? "");
  const [copperCurrency, setCopperCurrency] = useState(param?.copper_currency ?? "USD");
  const [copperUnit, setCopperUnit] = useState(normalizeCopperUnit(param?.copper_unit));
  const [fxFrom, setFxFrom] = useState(param?.fx_from_currency ?? "EUR");
  const [fxTo, setFxTo] = useState(param?.fx_to_currency ?? "USD");
  const [fxRate, setFxRate] = useState(param?.fx_rate ?? "");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useUiTranslate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload: Partial<MarketParameter> = {
      parameter_type: type,
      valid_from: validFrom,
      valid_to: validTo || null,
      is_active: isActive,
      notes,
      source,
    };
    if (type === "copper_price") {
      payload.copper_market = copperMarket as MarketParameter["copper_market"];
      payload.copper_price = copperPrice;
      payload.copper_currency = copperCurrency;
      payload.copper_unit = copperUnit;
    } else {
      if (fxFrom === fxTo) {
        setError(t("settings.market.fxSame"));
        setSaving(false);
        return;
      }
      const parsedRate = parseFloat(fxRate);
      if (!Number.isFinite(parsedRate) || parsedRate <= 0) {
        setError(t("settings.market.fxInvalid"));
        setSaving(false);
        return;
      }
      payload.fx_from_currency = fxFrom;
      payload.fx_to_currency = fxTo;
      payload.fx_rate = parsedRate.toFixed(2);
    }
    try {
      if (param) await updateMarketParameter(param.id, payload);
      else await createMarketParameter(payload);
      await globalMutate("market-params");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
      setSaving(false);
    }
  };

  return (
    <AppModal
      open
      onOpenChange={(open) => !open && onClose()}
      title={param ? t("settings.market.editTitle") : t("settings.market.createTitle")}
      size="lg"
    >
      {error && (
        <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <form onSubmit={submit} className="flex flex-col gap-4">
        <FormField label={t("settings.type")}>
          <div className="flex gap-2">
            {(["copper_price", "fx_rate"] as MarketParameterType[]).map((kind) => (
              <Button
                type="button"
                key={kind}
                variant={type === kind ? "default" : "outline"}
                className="flex-1"
                onClick={() => setType(kind)}
                disabled={!!param}
              >
                {kind === "copper_price" ? t("settings.market.copperPrice") : t("settings.market.fxRate")}
              </Button>
            ))}
          </div>
        </FormField>

        {type === "copper_price" ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <FormField label={t("settings.market.market")}>
                <OptionSelect
                  value={copperMarket ?? "LME"}
                  onValueChange={(v) => setCopperMarket(v as "LME" | "SHE")}
                  options={COPPER_MARKETS.map((m) => ({ value: m.value, label: t(m.labelKey) }))}
                />
              </FormField>
              <FormField label={t("settings.currency")}>
                <OptionSelect
                  value={copperCurrency ?? "USD"}
                  onValueChange={setCopperCurrency}
                  options={MARKET_CURRENCIES.map((c) => ({ value: c.value, label: t(c.labelKey) }))}
                />
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label={t("settings.market.price")} required>
                <Input
                  value={copperPrice ?? ""}
                  onChange={(e) => setCopperPrice(e.target.value)}
                  required
                  type="number"
                  step="0.0001"
                />
              </FormField>
              <FormField label={t("settings.market.unit")}>
                <OptionSelect
                  value={copperUnit}
                  onValueChange={setCopperUnit}
                  options={COPPER_UNITS.map((u) => ({ value: u.value, label: t(u.labelKey) }))}
                />
              </FormField>
            </div>
          </>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <FormField label={t("settings.market.from")} required>
              <OptionSelect
                value={fxFrom ?? "EUR"}
                onValueChange={setFxFrom}
                options={MARKET_CURRENCIES.map((c) => ({ value: c.value, label: t(c.labelKey) }))}
              />
            </FormField>
            <FormField label={t("settings.market.to")} required>
              <OptionSelect
                value={fxTo ?? "USD"}
                onValueChange={setFxTo}
                options={MARKET_CURRENCIES.map((c) => ({ value: c.value, label: t(c.labelKey) }))}
              />
            </FormField>
            <FormField label={t("settings.market.rate")} required>
              <Input
                value={fxRate ?? ""}
                onChange={(e) => setFxRate((prev) => sanitizeFxRateInput(e.target.value, prev))}
                required
                type="text"
                inputMode="decimal"
                placeholder={t("settings.market.ratePlaceholder")}
              />
            </FormField>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <FormField label={t("settings.market.validFrom")} required>
            <Input
              value={validFrom}
              onChange={(e) => setValidFrom(e.target.value)}
              required
              type="date"
            />
          </FormField>
          <FormField label={t("settings.market.validTo")}>
            <Input value={validTo ?? ""} onChange={(e) => setValidTo(e.target.value)} type="date" />
          </FormField>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="market-param-active"
            checked={isActive}
            onCheckedChange={(v) => setIsActive(v === true)}
          />
          <Label htmlFor="market-param-active" className="text-sm font-normal">
            {t("settings.active")}
          </Label>
        </div>

        <FormField label={t("settings.market.source")}>
          <Input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder={t("settings.market.sourcePlaceholder")}
          />
        </FormField>

        <FormField label={t("settings.notes")}>
          <Textarea value={notes ?? ""} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </FormField>

        <div className="flex gap-3 pt-2">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={saving} className="flex-1">
            {saving && <AppIcon icon={CircleNotch} size="sm" className="animate-spin" />}
            {param ? t("settings.update") : t("common.create")}
          </Button>
        </div>
      </form>
    </AppModal>
  );
}

function TabMarche() {
  const { displayLanguage } = useAuth();
  const t = useUiTranslate();
  const confirm = useConfirm();
  const { data, isLoading, error } = useSWR<MarketParameter[]>("market-params", () =>
    listMarketParameters(),
  );
  const [editing, setEditing] = useState<MarketParameter | "new" | null>(null);

  const handleDelete = async (p: MarketParameter) => {
    const ok = await confirm({
      title: t("settings.market.deleteTitle"),
      description: t("settings.market.deleteDescription"),
      confirmLabel: t("common.delete"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteMarketParameter(p.id);
      await globalMutate("market-params");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("settings.deleteFailed"));
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t("settings.market.intro")}</p>
        <Button onClick={() => setEditing("new")}>
          <AppIcon icon={Plus} size="sm" />
          {t("settings.market.new")}
        </Button>
      </div>

      <Card className="overflow-hidden py-0">
        {error ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {t("settings.market.loadError")}
          </div>
        ) : isLoading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">{t("common.loading")}</div>
        ) : !data?.length ? (
          <div className="py-12 text-center text-muted-foreground">
            <AppIcon icon={Coins} size="xl" className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">{t("settings.market.empty")}</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="border-b border-border bg-muted/50">
              <tr>
                {MARKET_COLUMN_KEYS.map((key, i) => (
                  <th
                    key={key || i}
                    className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {key ? t(key) : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.map((p) => (
                <tr key={p.id} className="hover:bg-muted/30">
                  <td className="px-4 py-2.5 text-sm font-medium text-foreground">
                    {p.parameter_type === "copper_price"
                      ? t("settings.market.copper")
                      : t("settings.market.fx")}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-muted-foreground">
                    {p.parameter_type === "copper_price"
                      ? `${p.copper_market} : ${p.copper_price} ${p.copper_currency}/${copperUnitLabel(p.copper_unit, t)}`
                      : `1 ${p.fx_from_currency} = ${formatFxRateDisplay(p.fx_rate, displayLanguage)} ${p.fx_to_currency}`}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-muted-foreground">{p.valid_from}</td>
                  <td className="px-4 py-2.5 text-sm text-muted-foreground">{p.valid_to || "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-sm text-muted-foreground">
                    {formatMarketParamUpdatedAt(p.updated_at, displayLanguage)}
                  </td>
                  <td className="px-4 py-2.5">
                    <ActiveBadge active={p.is_active} />
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setEditing(p)}
                        title={t("common.edit")}
                      >
                        <AppIcon icon={PencilSimple} size="sm" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleDelete(p)}
                        title={t("common.delete")}
                      >
                        <AppIcon icon={Trash} size="sm" className="text-muted-foreground" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {editing !== null && (
        <MarketParamModal
          param={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

// ── Tab : Transport modes ────────────────────────────────────────────────
function TransportModeModal({ mode, onClose }: { mode?: TransportMode; onClose: () => void }) {
  const [code, setCode] = useState(mode?.code ?? "");
  const [labelFr, setLabelFr] = useState(mode?.label?.fr ?? "");
  const [category, setCategory] = useState<TransportMode["category"]>(mode?.category ?? "maritime");
  const [capacity, setCapacity] = useState(mode?.default_pallet_capacity?.toString() ?? "");
  const [isActive, setIsActive] = useState(mode?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useUiTranslate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload: Partial<TransportMode> = {
      code: code.trim().toUpperCase(),
      label: { fr: labelFr.trim() },
      category,
      default_pallet_capacity: capacity ? parseInt(capacity, 10) : null,
      is_active: isActive,
    };
    try {
      if (mode) await updateTransportMode(mode.id, payload);
      else await createTransportMode(payload);
      await globalMutate("transport-modes");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
      setSaving(false);
    }
  };

  return (
    <AppModal
      open
      onOpenChange={(open) => !open && onClose()}
      title={mode ? t("settings.transport.editTitle") : t("settings.transport.createTitle")}
      size="lg"
    >
      {error && (
        <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <FormField label={t("settings.code")} required>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              maxLength={32}
              placeholder={t("settings.transport.codePlaceholder")}
            />
          </FormField>
          <FormField label={t("settings.category")} required>
            <OptionSelect
              value={category}
              onValueChange={(v) => setCategory(v as TransportMode["category"])}
              options={TRANSPORT_CATEGORIES.map((c) => ({ value: c.value, label: t(c.labelKey) }))}
            />
          </FormField>
        </div>
        <FormField label={t("settings.transport.labelFr")} required>
          <Input
            value={labelFr}
            onChange={(e) => setLabelFr(e.target.value)}
            required
            placeholder={t("settings.transport.labelPlaceholder")}
          />
        </FormField>
        <FormField label={t("settings.transport.capacity")}>
          <Input
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            type="number"
            min={0}
          />
        </FormField>
        <div className="flex items-center gap-2">
          <Checkbox
            id="transport-mode-active"
            checked={isActive}
            onCheckedChange={(v) => setIsActive(v === true)}
          />
          <Label htmlFor="transport-mode-active" className="text-sm font-normal">
            {t("settings.active")}
          </Label>
        </div>
        <div className="flex gap-3 pt-2">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={saving} className="flex-1">
            {saving && <AppIcon icon={CircleNotch} size="sm" className="animate-spin" />}
            {mode ? t("settings.update") : t("common.create")}
          </Button>
        </div>
      </form>
    </AppModal>
  );
}

function TabTransport() {
  const t = useUiTranslate();
  const confirm = useConfirm();
  const { data, isLoading, error } = useSWR<TransportMode[]>("transport-modes", () =>
    listTransportModes(),
  );
  const [editing, setEditing] = useState<TransportMode | "new" | null>(null);

  const handleDelete = async (m: TransportMode) => {
    const ok = await confirm({
      title: t("settings.transport.deleteTitle"),
      description: t("settings.transport.deleteDescription", { code: m.code }),
      confirmLabel: t("common.delete"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteTransportMode(m.id);
      await globalMutate("transport-modes");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("settings.deleteFailed"));
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t("settings.transport.intro")}</p>
        <Button onClick={() => setEditing("new")}>
          <AppIcon icon={Plus} size="sm" />
          {t("settings.transport.new")}
        </Button>
      </div>

      <Card className="overflow-hidden py-0">
        {error ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {t("settings.loadFailed")}
          </div>
        ) : isLoading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">{t("common.loading")}</div>
        ) : !data?.length ? (
          <div className="py-12 text-center text-muted-foreground">
            <AppIcon icon={Truck} size="xl" className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">{t("settings.transport.empty")}</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="border-b border-border bg-muted/50">
              <tr>
                {TRANSPORT_COLUMN_KEYS.map((key, i) => (
                  <th
                    key={key || i}
                    className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {key ? t(key) : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.map((m) => (
                <tr key={m.id} className="hover:bg-muted/30">
                  <td className="px-4 py-2.5 font-mono text-sm font-semibold text-foreground">
                    {m.code}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-muted-foreground">
                    {m.label?.fr ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-muted-foreground">
                    {transportCategoryLabel(m.category, t)}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-muted-foreground">
                    {m.default_pallet_capacity ?? "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <ActiveBadge active={m.is_active} />
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setEditing(m)}
                        title={t("common.edit")}
                      >
                        <AppIcon icon={PencilSimple} size="sm" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleDelete(m)}
                        title={t("common.delete")}
                      >
                        <AppIcon icon={Trash} size="sm" className="text-muted-foreground" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {editing !== null && (
        <TransportModeModal
          mode={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

// ── Tab : Odoo sync ──────────────────────────────────────────────────────
const SYNC_SCOPES = [
  { id: "all", labelKey: "settings.odoo.scope.all" },
  { id: "products", labelKey: "settings.odoo.scope.products" },
  { id: "stock", labelKey: "settings.odoo.scope.stock" },
  { id: "clients", labelKey: "settings.odoo.scope.clients" },
] as const;

function syncStatusBadge(s: SyncLog["status"]) {
  const map = {
    success: { Icon: CheckCircle, variant: "success" as const, labelKey: "settings.odoo.status.success" as const },
    failed: { Icon: XCircle, variant: "failed" as const, labelKey: "settings.odoo.status.failed" as const },
    partial_failure: {
      Icon: Warning,
      variant: "warning" as const,
      labelKey: "settings.odoo.status.partial" as const,
    },
    running: { Icon: CircleDashed, variant: "running" as const, labelKey: "settings.odoo.status.running" as const },
  } as const;
  return map[s] ?? map.running;
}

function TabOdoo() {
  const { displayLanguage } = useAuth();
  const t = useUiTranslate();
  const { data: health } = useSWR<{ ok: boolean }>("odoo-health", getOdooHealth, {
    refreshInterval: 30_000,
  });
  const { data: status } = useSWR<SyncStatus>("odoo-sync-status", getSyncStatus, {
    refreshInterval: 5_000,
  });
  const { data: logs } = useSWR<SyncLog[]>("odoo-sync-logs", () => listSyncLogs(20), {
    refreshInterval: 5_000,
  });

  const [scope, setScope] = useState<(typeof SYNC_SCOPES)[number]["id"]>("all");
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTrigger = async () => {
    setSyncing(true);
    setError(null);
    try {
      await triggerOdooSync(scope);
      await Promise.all([
        globalMutate("odoo-sync-status"),
        globalMutate("odoo-sync-logs"),
        globalMutate("odoo-health"),
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("settings.odoo.syncFailed"));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("settings.odoo.health")}
            </span>
            <AppIcon icon={Pulse} size="sm" className="text-muted-foreground" />
          </div>
          <div className="mt-3 flex items-center gap-2">
            {health == null ? (
              <span className="text-sm text-muted-foreground">…</span>
            ) : health.ok ? (
              <>
                <AppIcon icon={CheckCircle} size="md" className="text-brand-green" />
                <span className="text-base font-semibold text-brand-green">{t("settings.odoo.connected")}</span>
              </>
            ) : (
              <>
                <AppIcon icon={XCircle} size="md" className="text-destructive" />
                <span className="text-base font-semibold text-destructive">{t("settings.odoo.offline")}</span>
              </>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t("settings.odoo.healthHint")}</p>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("settings.odoo.manual")}
            </span>
            <AppIcon icon={Database} size="sm" className="text-muted-foreground" />
          </div>
          {error && (
            <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
              {error}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <OptionSelect
              value={scope}
              onValueChange={(v) => setScope(v as typeof scope)}
              disabled={syncing}
              className="min-w-[260px] flex-1"
              options={SYNC_SCOPES.map((s) => ({ value: s.id, label: t(s.labelKey) }))}
            />
            <Button onClick={handleTrigger} disabled={syncing}>
              {syncing ? (
                <AppIcon icon={CircleNotch} size="sm" className="animate-spin" />
              ) : (
                <AppIcon icon={ArrowsClockwise} size="sm" />
              )}
              {syncing ? t("settings.odoo.syncing") : t("settings.odoo.start")}
            </Button>
          </div>
          {status?.running && (
            <p className="mt-3 text-xs text-brand-blue">
              {t("settings.odoo.running", {
                scope: status.running.scope,
                date: new Date(status.running.started_at).toLocaleString(uiDateLocale(displayLanguage)),
              })}
            </p>
          )}
        </Card>
      </div>

      <Card className="overflow-hidden py-0">
        <div className="border-b border-border px-5 py-3">
          <h3 className="text-sm font-semibold text-foreground">{t("settings.odoo.history")}</h3>
        </div>
        {!logs ? (
          <div className="py-10 text-center text-sm text-muted-foreground">{t("common.loading")}</div>
        ) : logs.length === 0 ? (
          <div className="py-10 text-center text-muted-foreground">
            <AppIcon icon={Database} size="lg" className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">{t("settings.odoo.empty")}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-border bg-muted/50">
                <tr>
                  {ODOO_COLUMN_KEYS.map((key) => (
                    <th
                      key={key}
                      className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      {t(key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {logs.map((l) => {
                  const b = syncStatusBadge(l.status);
                  return (
                    <tr key={l.id} className="hover:bg-muted/30">
                      <td className="whitespace-nowrap px-4 py-2 text-sm text-foreground">
                        {new Date(l.started_at).toLocaleString(uiDateLocale(displayLanguage))}
                      </td>
                      <td className="px-4 py-2 text-sm capitalize text-muted-foreground">
                        {l.sync_type}
                      </td>
                      <td className="px-4 py-2 text-sm text-muted-foreground">{l.scope}</td>
                      <td className="px-4 py-2">
                        <StatusBadge variant={b.variant} className="gap-1">
                          <AppIcon icon={b.Icon} size="sm" />
                          {t(b.labelKey)}
                        </StatusBadge>
                      </td>
                      <td className="px-4 py-2 text-sm text-muted-foreground">{l.items_created}</td>
                      <td className="px-4 py-2 text-sm text-muted-foreground">{l.items_updated}</td>
                      <td
                        className={cn(
                          "px-4 py-2 text-sm",
                          l.items_failed
                            ? "font-semibold text-destructive"
                            : "text-muted-foreground",
                        )}
                      >
                        {l.items_failed}
                      </td>
                      <td className="px-4 py-2 text-sm text-muted-foreground">{l.triggered_by}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ── Tab : Alertes offres (J-7 expiration recipients) ─────────────────────
function TabAlerts() {
  const t = useUiTranslate();
  const { data, isLoading } = useSWR<OfferAlertSettings>(
    "offer-alert-settings",
    getOfferAlertSettings,
  );
  const [draft, setDraft] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const recipients = draft ?? data?.recipients ?? [];
  const edit = (next: string[]) => {
    setDraft(next);
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const clean = recipients.map((r) => r.trim()).filter(Boolean);
      await updateOfferAlertSettings(clean);
      await globalMutate("offer-alert-settings");
      setDraft(null);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("settings.alerts.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <p className="mb-5 text-sm text-muted-foreground">{t("settings.alerts.intro")}</p>

      <Card className="p-5">
        {error && (
          <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
        {isLoading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">{t("common.loading")}</div>
        ) : (
          <>
            <FormField label={t("settings.alerts.emails")}>
              <div className="flex flex-col gap-2">
                {recipients.length === 0 && (
                  <p className="py-2 text-sm text-muted-foreground">{t("settings.alerts.empty")}</p>
                )}
                {recipients.map((addr, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <AppIcon icon={Envelope} size="sm" className="shrink-0 text-muted-foreground" />
                    <Input
                      type="email"
                      value={addr}
                      onChange={(e) =>
                        edit(recipients.map((r, idx) => (idx === i ? e.target.value : r)))
                      }
                      placeholder={t("settings.alerts.emailPlaceholder")}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => edit(recipients.filter((_, idx) => idx !== i))}
                      title={t("settings.alerts.remove")}
                    >
                      <AppIcon icon={Trash} size="sm" className="text-muted-foreground" />
                    </Button>
                  </div>
                ))}
              </div>
            </FormField>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-3"
              onClick={() => edit([...recipients, ""])}
            >
              <AppIcon icon={Plus} size="sm" />
              {t("settings.alerts.add")}
            </Button>

            <div className="mt-5 flex items-center gap-3 border-t border-border pt-4">
              <Button onClick={save} disabled={saving}>
                {saving && <AppIcon icon={CircleNotch} size="sm" className="animate-spin" />}
                {t("common.save")}
              </Button>
              {saved && <span className="text-sm text-brand-green">{t("settings.alerts.saved")}</span>}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

// ── Settings page (query-param driven tabs) ──────────────────────────────
function SettingsContent() {
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") ?? "marche";

  return (
    <>
      <SettingsNav />
      {tab === "transport-presets" ? (
        <TabTransportPresets />
      ) : tab === "transport" ? (
        <TabTransport />
      ) : tab === "odoo" ? (
        <TabOdoo />
      ) : tab === "alerts" ? (
        <TabAlerts />
      ) : (
        <TabMarche />
      )}
    </>
  );
}

export default function SettingsPage() {
  const t = useUiTranslate();
  const { isLoading, allowed, denied } = useRequireAdmin();

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="py-12 text-center text-sm text-muted-foreground">{t("common.loading")}</div>
      </div>
    );
  }

  if (denied) {
    return (
      <div className="p-6">
        <div className="py-12 text-center text-sm text-muted-foreground">{t("settings.adminOnly")}</div>
      </div>
    );
  }

  if (!allowed) {
    return null;
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">{t("settings.title")}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("settings.subtitle")}</p>
      </div>

      <Suspense
        fallback={
          <>
            <SettingsNavFallback />
            <div className="py-12 text-center text-sm text-muted-foreground">{t("common.loading")}</div>
          </>
        }
      >
        <SettingsContent />
      </Suspense>
    </div>
  );
}
