"use client";

import { createContext, useContext } from "react";
import type { AttributeCategory, AttributeRegistry, ProductDetail } from "@/lib/api";

export type EditMode = "read" | "edit";
export type DescriptionKind = "marketing" | "technical";

/**
 * Shared editing surface for the product detail tabs.
 * The page owns the draft state and exposes these accessors so each tab can
 * read merged values and commit changes without prop-drilling.
 */
export interface EditContextValue {
  mode: EditMode;
  lang: string;
  product: ProductDetail;
  /** Merged display value for a core product field (draft over server). */
  coreValue: (field: keyof ProductDetail) => unknown;
  setCore: (field: keyof ProductDetail, value: unknown, valid: boolean) => void;
  /** Merged value for one language of a multilingual description field. */
  descValue: (which: DescriptionKind, lang: string) => string;
  setDesc: (which: DescriptionKind, lang: string, value: string) => void;
  /** Registry attributes for a category, ordered by display_order. */
  attrsByCategory: (cat: AttributeCategory) => AttributeRegistry[];
  /** Merged value for an attribute (draft over server). */
  attrValue: (attrId: string) => unknown;
  setAttr: (attrId: string, value: unknown, valid: boolean) => void;
}

export const EditContext = createContext<EditContextValue | null>(null);

export function useEdit(): EditContextValue {
  const ctx = useContext(EditContext);
  if (!ctx) throw new Error("useEdit must be used within an EditContext provider");
  return ctx;
}
