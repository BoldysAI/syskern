"use client";

import { useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { Check, Search, X } from "lucide-react";
import { getClients, type Client, type SimulationType } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  label: string;
  type: SimulationType;
  clientIds: string[];
  projectName: string;
  onLabel: (v: string) => void;
  onType: (v: SimulationType) => void;
  onClientIds: (ids: string[]) => void;
  onProjectName: (v: string) => void;
}

const inputCls =
  "w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary";
const labelCls = "block text-xs font-semibold text-slate-600 mb-1.5";

export function TypeStep({
  label,
  type,
  clientIds,
  projectName,
  onLabel,
  onType,
  onClientIds,
  onProjectName,
}: Props) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onSearchChange = (v: string) => {
    setSearch(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebounced(v), 300);
  };

  const { data: clients, isLoading } = useSWR<Client[]>(["clients", debounced], () =>
    getClients(debounced || undefined)
  );

  // Keep a name lookup so selected chips render even when filtered out.
  const [knownNames, setKnownNames] = useState<Record<string, string>>({});
  const nameFor = (id: string) => knownNames[id] ?? id;

  const remember = (c: Client) =>
    setKnownNames((prev) => (prev[c.id] ? prev : { ...prev, [c.id]: c.name }));

  const selectMulti = (c: Client) => {
    remember(c);
    onClientIds(
      clientIds.includes(c.id) ? clientIds.filter((x) => x !== c.id) : [...clientIds, c.id]
    );
  };

  const selectSingle = (c: Client) => {
    remember(c);
    onClientIds([c.id]);
  };

  const selectedSet = useMemo(() => new Set(clientIds), [clientIds]);

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <div>
        <label className={labelCls}>Libellé *</label>
        <input
          value={label}
          onChange={(e) => onLabel(e.target.value)}
          placeholder="ex. Tarif Q2 2026"
          className={inputCls}
        />
      </div>

      <div>
        <label className={labelCls}>Type *</label>
        <div className="flex gap-2">
          {(["tariff", "project"] as SimulationType[]).map((t) => (
            <button
              type="button"
              key={t}
              onClick={() => onType(t)}
              className={cn(
                "flex-1 py-2 text-sm font-medium rounded-lg border transition-colors",
                type === t
                  ? "border-primary bg-accent text-accent-foreground"
                  : "border-border text-slate-600 hover:bg-slate-50"
              )}
            >
              {t === "tariff" ? "Tarif (multi-clients)" : "Projet (1 client)"}
            </button>
          ))}
        </div>
      </div>

      {type === "project" && (
        <div>
          <label className={labelCls}>Nom du projet *</label>
          <input
            value={projectName}
            onChange={(e) => onProjectName(e.target.value)}
            placeholder="ex. Datacenter Lyon"
            className={inputCls}
          />
        </div>
      )}

      <div>
        <label className={labelCls}>
          {type === "tariff" ? "Clients (optionnel)" : "Client *"}
        </label>

        {/* Selected chips */}
        {clientIds.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {clientIds.map((id) => (
              <span
                key={id}
                className="inline-flex items-center gap-1.5 pl-3 pr-2 py-1 text-sm rounded-full bg-accent text-accent-foreground border border-primary/30"
              >
                {nameFor(id)}
                <button
                  type="button"
                  onClick={() => onClientIds(clientIds.filter((x) => x !== id))}
                  className="text-accent-foreground/70 hover:text-accent-foreground"
                  aria-label={`Retirer ${nameFor(id)}`}
                >
                  <X size={14} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Rechercher un client…"
            className={cn(inputCls, "pl-9")}
          />
        </div>

        <div className="mt-2 border border-border rounded-lg max-h-52 overflow-y-auto divide-y divide-[#F1F5F9]">
          {isLoading ? (
            <p className="py-6 text-center text-sm text-slate-400">Chargement…</p>
          ) : !clients?.length ? (
            <p className="py-6 text-center text-sm text-slate-400">Aucun client trouvé.</p>
          ) : (
            clients.map((c) => {
              const selected = selectedSet.has(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => (type === "tariff" ? selectMulti(c) : selectSingle(c))}
                  className={cn(
                    "flex items-center justify-between gap-2 w-full px-3 py-2 text-left hover:bg-slate-50",
                    selected && "bg-orange-50/70"
                  )}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-800 truncate">
                      {c.name}
                    </span>
                    {(c.address_city || c.is_prospect) && (
                      <span className="block text-xs text-slate-400">
                        {c.is_prospect ? "Prospect" : "Client"}
                        {c.address_city ? ` · ${c.address_city}` : ""}
                      </span>
                    )}
                  </span>
                  {selected && <Check size={16} className="text-warm shrink-0" />}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
