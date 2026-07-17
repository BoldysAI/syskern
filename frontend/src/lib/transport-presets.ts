/** Helpers for transport leg presets (data lives in API `transport-presets`). */

import type { TransportPreset } from "@/lib/api";
import type { TransportDraft } from "@/app/simulator/new/_components/wizard-draft";

export function presetToTransportDraft(preset: TransportPreset): Partial<TransportDraft> {
  return {
    transport_mode_code: preset.transport_mode_code,
    category: preset.category,
    global_cost: preset.global_cost,
    currency: preset.currency,
    pallet_count: preset.pallet_count,
    from_location: preset.from_location,
    to_location: preset.to_location,
  };
}

export function transportDraftToPresetPayload(
  transport: TransportDraft,
  name: string,
  defaultCurrency = "EUR",
): Partial<TransportPreset> {
  return {
    name: name.trim(),
    transport_mode_code: transport.transport_mode_code.trim(),
    category: (transport.category || "road") as TransportPreset["category"],
    global_cost: transport.global_cost.trim(),
    currency: transport.currency || defaultCurrency,
    pallet_count: transport.pallet_count.trim(),
    from_location: transport.from_location.trim(),
    to_location: transport.to_location.trim(),
    is_active: true,
  };
}

export function canSaveTransportAsPreset(transport: TransportDraft): boolean {
  return Boolean(transport.transport_mode_code?.trim());
}
