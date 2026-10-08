"""Interface language resolution (stories 7.1 and 7.2).

Product content stays on the DeepL stack in ``apps.i18n``. This module only
picks the UI language and translates interface message keys. User-facing HTTP
errors use ``translate`` / ``translate_request``; a missing English entry stays
the French source sentence for that key.

Displayed language:

    Profile.locale if set
    else DEFAULT_UI_LOCALE (one value per deployment)
    else "fr"

A missing translation falls back to French for that key alone.
"""

from __future__ import annotations

from typing import Any

from django.conf import settings
from django.core.exceptions import ObjectDoesNotExist

UI_LOCALES = ("fr", "en")
FALLBACK_UI_LOCALE = "fr"

FR: dict[str, str] = {
    "login.title": "Connexion",
    "auth.missing_credentials": "Email et mot de passe requis.",
    "auth.invalid_credentials": "Identifiants incorrects.",
    "auth.rate_limited": "Trop de tentatives. Réessaye dans {minutes} minutes.",
    "users.email_taken": "Un compte existe déjà avec cette adresse e-mail.",
    "users.not_found": "Introuvable.",
    "users.cannot_delete_self": "Vous ne pouvez pas supprimer votre propre compte.",
    "users.admin_only": "Accès réservé aux administrateurs.",
    "users.locale_invalid": "Langue d'interface inconnue.",
    "users.commercial_or_admin": "Accès réservé aux commerciaux et administrateurs.",
    "auth.authentication_required": "Authentification requise.",
    "tasks.failed": "Tâche échouée",
    "attributes.option_not_object": "Option at index {idx} must be an object with a 'value' key.",
    "attributes.option_missing_value": "Option at index {idx} is missing required key 'value'.",
    "attributes.expected_text": "Expected a string for data_type 'text'.",
    "attributes.expected_number": "Expected a numeric value for data_type 'number', got {value}.",
    "attributes.expected_boolean": "Expected true or false for data_type 'boolean', got {value}.",
    "attributes.expected_date": (
        "Expected ISO 8601 date (YYYY-MM-DD) for data_type 'date', got {value}."
    ),
    "attributes.select_invalid": "Invalid value for data_type 'select': {value} is not in options.",
    "attributes.expected_multiselect": "Expected a list of values for data_type 'multiselect'.",
    "attributes.multiselect_invalid": (
        "Invalid values for data_type 'multiselect': {invalid} are not in options."
    ),
    "attributes.code_immutable": "Attribute code is immutable.",
    "attributes.french_label_required": "French label (`fr`) is required.",
    "attributes.options_required": "At least one option required for select/multiselect.",
    "attributes.default_required": "Une valeur par défaut est requise pour un attribut obligatoire.",
    "products.target_lang_required": (
        "Au moins une langue cible différente de la source est requise."
    ),
    "products.copper_weight_required": "Required and > 0 when is_copper_indexed is true.",
    "products.french_description_required": "French description (`fr`) is required.",
    "products.sku_required": "Le champ « sku » est requis.",
    "products.pamp_not_linked": "Produit non lié à Odoo — PAMP non recalculable.",
    "products.target_lang_invalid": "Langue cible invalide (attendu : en ou es).",
    "products.no_french_description": "Aucune description française à traduire.",
    "products.invalid_level": "invalid level",
    "products.name_param_required": "Le paramètre « name » est requis.",
    "exports.not_found": "Export introuvable ou expiré.",
    "suppliers.incoterm_unknown": "Incoterm inconnu.",
    "suppliers.sku_or_product": "Fournis un « sku » ou un « product_id ».",
    "suppliers.links_or_products": "Fournis « link_ids » ou « product_ids ».",
    "suppliers.po_negative": "Le PO ne peut pas être négatif.",
    "suppliers.mapping_invalid": "Mapping invalide.",
    "suppliers.mapping_unknown_fields": "Champs inconnus dans le mapping : {fields}.",
    "suppliers.column_index_invalid": "Index de colonne invalide.",
    "suppliers.mapping_missing_fields": "Champs obligatoires manquants : {fields}.",
    "suppliers.delete_has_skus": (
        "Impossible de supprimer ce fournisseur : des SKU y sont encore liés. "
        "Retirez d'abord les SKU liés."
    ),
    "suppliers.sku_not_found": "SKU introuvable.",
    "suppliers.sku_already_linked": "Ce SKU est déjà lié à ce fournisseur.",
    "suppliers.file_required": "Aucun fichier fourni (champ « file »).",
    "suppliers.excel_expected": "Format attendu : fichier Excel (.xlsx).",
    "suppliers.import_file_missing": ("Fichier d'import introuvable ou expiré. Relancez l'upload."),
    "suppliers.report_missing": "Rapport introuvable ou expiré.",
    "market.transport_required": "Le mode de transport est requis.",
    "market.transport_unknown": "Mode de transport inconnu ou inactif : {code}.",
    "market.name_required": "Le nom est requis.",
    "market.copper_price_required": "Required for copper_price.",
    "market.fx_rate_required": "Required for fx_rate.",
    "market.fx_currencies_required": "fx_from_currency / fx_to_currency required for fx_rate.",
    "market.parameter_type_required": "parameter_type requis : copper_price ou fx_rate.",
    "market.fx_pair_required": "fx_from_currency et fx_to_currency requis pour fx_rate.",
    "market.none_active": "Aucun paramètre actif trouvé.",
    "migration.product_required": "Requis pour créer le produit (au moins le code SKU).",
    "offers.finalized_only": "Offers can only be created from finalized simulations.",
    "offers.delete_while_generating": (
        "Impossible de supprimer une offre en cours de génération. "
        "Réessayez une fois la génération terminée."
    ),
    "offers.transition_forbidden": "Transition {from_status} → {to_status} non autorisée.",
    "offers.won_lost_project_only": "won/lost transitions only apply to project offers.",
    "offers.project_version_only": "Seules les offres projet sont versionnables.",
    "offers.expiration_too_soon": "La nouvelle date doit être à plus de 7 jours.",
    "offers.regenerate_project_only": "La régénération concerne les offres projet.",
    "offers.document_missing": "Document non généré ou expiré.",
    "offers.pdf_unavailable": "PDF du devis non disponible (génération Gamma incomplète).",
    "offers.pdf_fetch_failed": "Impossible de récupérer le PDF du devis Gamma.",
    "offers.generation_stub": "Generation stub — Gamma integration pending.",
    "offers.project_one_client": "Project offers target exactly one client.",
    "offers.tariff_needs_client": "Tariff offers require at least one client.",
    "offers.clients_not_found": "Clients introuvables : {missing}",
    "offers.client_not_found": "Client introuvable : {value}",
    "offers.quantities_positive": "Les quantités doivent être strictement positives.",
    "simulations.project_name_required": "Le nom du projet est requis pour une simulation projet.",
    "simulations.project_one_client": "Une simulation projet doit cibler exactement un client.",
    "simulations.lines_payload": (
        "Fournir product_ids ou items (product_id + paramètres optionnels)."
    ),
    "simulations.compare_count": "Sélectionnez entre 2 et 4 éléments à comparer.",
    "simulations.compare_max": "La comparaison est limitée à 4 éléments.",
    "simulations.duplicate_simulations": "Doublon dans les simulations sélectionnées.",
    "simulations.duplicate_recalcs": "Doublon dans les recalculs sélectionnés.",
    "simulations.sims_not_found": "Certaines simulations sont introuvables.",
    "simulations.recalcs_not_found": "Certains recalculs sont introuvables.",
    "simulations.finalized_readonly": "Une simulation finalisée est en lecture seule.",
    "simulations.archived_readonly": "Une simulation archivée est en lecture seule.",
    "simulations.finalized_no_delete": (
        "Une simulation finalisée ne peut pas être supprimée ; archivez-la."
    ),
    "simulations.delete_has_offers": (
        "Des offres sont rattachées à cette simulation ; archivez-la."
    ),
    "simulations.deleted": "Simulation supprimée.",
    "simulations.already_finalized": "Simulation déjà finalisée.",
    "simulations.archived_no_finalize": "Une simulation archivée ne peut pas être finalisée.",
    "simulations.never_calculated": (
        "Impossible de finaliser une simulation jamais calculée — lancez un recalcul d'abord."
    ),
    "simulations.lines_in_error": "Des lignes sont en erreur — corrigez-les avant de finaliser.",
    "simulations.recalculate_before_finalize": "Recalculez la simulation avant de finaliser.",
    "simulations.must_be_finalized": "La simulation doit être finalisée.",
    "simulations.tariff_generation_only": (
        "Génération tarifaire réservée aux simulations de type tarif."
    ),
    "simulations.project_generation_only": (
        "Génération projet réservée aux simulations de type projet."
    ),
    "simulations.archive_finalized_only": (
        "Seules les simulations finalisées peuvent être archivées."
    ),
    "simulations.not_archived": "Cette simulation n'est pas archivée.",
    "simulations.line_edit_locked": "Simulation non modifiable — édition des lignes interdite.",
    "simulations.line_delete_locked": (
        "Simulation non modifiable — suppression de ligne interdite."
    ),
    "simulations.line_recalc_locked": "Simulation non modifiable — recalcul de ligne interdit.",
    "simulations.comparison_invalid": (
        "Cette comparaison n'est plus valide : trop de simulations associées ont été supprimées."
    ),
    "simulations.simulation_deleted_label": "(simulation supprimée)",
    "simulations.recalc_deleted_label": "(recalcul supprimé)",
    "simulations.recalc_label": "Recalcul du {when}",
    "documents.file_required": "Un fichier est requis.",
    "documents.file_too_large": "Fichier trop volumineux (max 20 Mo).",
    "documents.bad_format": "Format non accepté (PDF, JPG, PNG, DOCX, XLSX).",
    "documents.file_missing": "Fichier introuvable ou purgé.",
    "suppliers.excel_unreadable": "Fichier Excel illisible : {reason}",
    "suppliers.header_row_missing": (
        "Ligne d'en-tête introuvable (fichier vide ou en-tête au-delà du fichier)."
    ),
    "suppliers.field_must_be_mapped": "Le champ « {field} » doit être mappé.",
    "suppliers.column_out_of_file": "Colonne invalide dans le fichier pour « {field} ».",
    "suppliers.reason_sku_not_found": "SKU introuvable en base",
    "suppliers.reason_supplier_not_found": "Fournisseur introuvable en base",
    "suppliers.reason_invalid_po": "PO manquant ou invalide",
    "suppliers.reason_no_supplier": "Aucun fournisseur (ni colonne ni sélection)",
    "suppliers.reason_missing_sku": "SKU manquant",
    "suppliers.selected_not_found": "Fournisseur sélectionné introuvable.",
    "suppliers.import_file_expired": "Fichier d'import introuvable ou expiré.",
    "offers.unknown_columns": "Unknown column(s): {unknown}. Valid: {valid}",
    "offers.task_tariff_type": "La simulation doit être de type tarif.",
    "offers.task_project_type": "La simulation doit être de type projet.",
    "offers.generation_failed": "Erreur de génération.",
    "offers.generation_timeout": "La génération a dépassé le temps imparti.",
    "offers.generation_interrupted": (
        "Génération interrompue (worker indisponible). Relancez la génération."
    ),
    "simulations.duplicate_label": "{label} (copie)",
    "i18n.text_or_texts": "Fournir soit « text » (chaîne unique) soit « texts » (liste).",
    "i18n.langs_must_differ": "La langue source et la langue cible doivent être différentes.",
    "_proof.only_fr": "Libellé français",
}

EN: dict[str, str] = {
    "login.title": "Sign in",
    "auth.missing_credentials": "Email and password are required.",
    "auth.invalid_credentials": "Incorrect email or password.",
    "auth.rate_limited": "Too many attempts. Try again in {minutes} minutes.",
    "users.email_taken": "An account already exists with this email address.",
    "users.not_found": "Not found.",
    "users.cannot_delete_self": "You cannot delete your own account.",
    "users.admin_only": "Administrators only.",
    "users.locale_invalid": "Unknown interface language.",
}


def resolve_ui_locale(user: Any) -> str:
    """Return ``fr`` or ``en`` for this user, then the deployment, then French."""
    locale = _profile_locale(user)
    if locale in UI_LOCALES:
        return locale
    deployment = str(getattr(settings, "DEFAULT_UI_LOCALE", "") or "").strip()
    if deployment in UI_LOCALES:
        return deployment
    return FALLBACK_UI_LOCALE


def translate(key: str, locale: str) -> str:
    """Return the catalog string. A missing target-language entry stays French."""
    if locale in UI_LOCALES and locale != FALLBACK_UI_LOCALE:
        translated = EN.get(key)
        if translated:
            return translated
    return FR[key]


def resolve_request_locale(request: Any) -> str:
    """Locale of a DRF request user, else the deployment default, else French."""
    user = getattr(request, "user", None) if request is not None else None
    return resolve_ui_locale(user)


def translate_request(request: Any, key: str, **kwargs: Any) -> str:
    """Catalog string for this request. Placeholders use ``str.format``."""
    message = translate(key, resolve_request_locale(request))
    return message.format(**kwargs) if kwargs else message


def _profile_locale(user: Any) -> str:
    if user is None or not getattr(user, "is_authenticated", False):
        return ""
    try:
        raw = user.profile.locale
    except ObjectDoesNotExist:
        return ""
    return str(raw or "").strip()
