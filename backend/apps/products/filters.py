"""Catalog filters (CDC §4.1.1)."""

from __future__ import annotations

import django_filters as filters
from django.contrib.postgres.search import SearchQuery, SearchRank
from django.db.models import F, Q

from apps.attributes.models import AttributeRegistry

from .models import Product

# Query params prefixed like `attr_<code>=value` filter on dynamic attributes.
_ATTR_PREFIX = "attr_"


class ProductFilter(filters.FilterSet):
    """Catalog filters: hierarchy cascade, brand, stock, supplier, attributes.

    Full-text search is exposed via the `q` param (Postgres `tsvector`,
    combining the `french` + `simple` dictionaries — CDC §4.1.1). Dynamic
    attribute filters use `attr_<code>=value` params and only honor
    attributes flagged `is_filterable` on the registry.
    """

    q = filters.CharFilter(method="filter_search")
    sku_code = filters.CharFilter(field_name="sku_code", lookup_expr="icontains")
    # Accepts one or several comma-separated values, matched case-insensitively.
    # e.g. ?universe=COPPER  or  ?universe=COPPER,OPTICAL FIBER
    universe = filters.CharFilter(method="filter_universe")
    family = filters.CharFilter(method="filter_family")
    range = filters.CharFilter(method="filter_range")
    sub_range = filters.CharFilter(method="filter_sub_range")
    brand = filters.CharFilter(method="filter_brand")
    factory_code = filters.CharFilter(method="filter_factory_code")
    supplier = filters.CharFilter(method="filter_supplier")
    is_active = filters.BooleanFilter(field_name="is_active")
    is_copper_indexed = filters.BooleanFilter(field_name="is_copper_indexed")

    # PV / PAMP price-range filters.
    pamp_min = filters.NumberFilter(field_name="pamp_eur", lookup_expr="gte")
    pamp_max = filters.NumberFilter(field_name="pamp_eur", lookup_expr="lte")

    # Stock availability — `gt=0` is the canonical "in stock" check.
    in_stock = filters.BooleanFilter(method="filter_in_stock")
    stock_min = filters.NumberFilter(field_name="stock_quantity", lookup_expr="gte")

    # Multilingual coverage — `true` keeps products missing at least one language
    # (< 100% coverage) so Olivier can spot untranslated SKUs (CDC §10.7.3).
    i18n_incomplete = filters.BooleanFilter(method="filter_i18n_incomplete")
    lang_fr_in = filters.BooleanFilter(method="filter_lang_fr_in")
    lang_fr_out = filters.BooleanFilter(method="filter_lang_fr_out")
    lang_en_in = filters.BooleanFilter(method="filter_lang_en_in")
    lang_en_out = filters.BooleanFilter(method="filter_lang_en_out")
    lang_es_in = filters.BooleanFilter(method="filter_lang_es_in")
    lang_es_out = filters.BooleanFilter(method="filter_lang_es_out")

    class Meta:
        model = Product
        fields = [
            "q",
            "sku_code",
            "universe",
            "family",
            "range",
            "sub_range",
            "brand",
            "factory_code",
            "supplier",
            "is_active",
            "is_copper_indexed",
        ]

    def filter_search(self, queryset, name, value: str):
        """Multilingual full-text search over the `search_vector` column.

        OR-combines a `french` query (FR stems) and a `simple` query (codes,
        EN/ES) so a term matches in any indexed language. Results are ranked
        by relevance when a query is present.
        """
        value = (value or "").strip()
        if not value:
            return queryset
        fr_query = SearchQuery(value, config="french", search_type="websearch")
        simple_query = SearchQuery(value, config="simple", search_type="websearch")
        return (
            queryset.filter(Q(search_vector=fr_query) | Q(search_vector=simple_query))
            .annotate(search_rank=SearchRank(F("search_vector"), fr_query))
            .order_by("-search_rank", "sku_code")
        )

    def filter_universe(self, queryset, name, value: str):
        return self._filter_csv_iexact(queryset, "universe", value)

    def filter_family(self, queryset, name, value: str):
        return self._filter_csv_iexact(queryset, "family", value)

    def filter_range(self, queryset, name, value: str):
        return self._filter_csv_iexact(queryset, "range", value)

    def filter_sub_range(self, queryset, name, value: str):
        return self._filter_csv_iexact(queryset, "sub_range", value)

    def filter_brand(self, queryset, name, value: str):
        return self._filter_csv_iexact(queryset, "brand", value)

    def filter_factory_code(self, queryset, name, value: str):
        return self._filter_csv_iexact(queryset, "factory_code", value)

    def filter_supplier(self, queryset, name, value: str):
        """Match products having a supplier with one of the given names."""
        values = [v.strip() for v in value.split(",") if v.strip()]
        if not values:
            return queryset
        q = Q()
        for v in values:
            q |= Q(suppliers__supplier_name__iexact=v)
        return queryset.filter(q).distinct()

    def filter_in_stock(self, queryset, name, value: bool):
        if value is None:
            return queryset
        if value:
            return queryset.filter(stock_quantity__gt=0)
        return queryset.filter(stock_quantity__lte=0) | queryset.filter(stock_quantity__isnull=True)

    @staticmethod
    def _lang_covered_q(lang: str) -> Q:
        """Non-empty marketing or technical description in ``lang``."""
        return (
            Q(**{f"description_marketing__{lang}__isnull": False})
            & ~Q(**{f"description_marketing__{lang}": ""})
        ) | (
            Q(**{f"description_technical__{lang}__isnull": False})
            & ~Q(**{f"description_technical__{lang}": ""})
        )

    def filter_i18n_incomplete(self, queryset, name, value: bool):
        """Keep products whose multilingual coverage is < 100% (CDC §10.7.3)."""
        if value is None:
            return queryset
        complete = (
            self._lang_covered_q("fr") & self._lang_covered_q("en") & self._lang_covered_q("es")
        )
        return queryset.exclude(complete) if value else queryset.filter(complete)

    def filter_lang_fr_in(self, queryset, name, value: bool):
        return queryset.filter(self._lang_covered_q("fr")) if value else queryset

    def filter_lang_fr_out(self, queryset, name, value: bool):
        return queryset.exclude(self._lang_covered_q("fr")) if value else queryset

    def filter_lang_en_in(self, queryset, name, value: bool):
        return queryset.filter(self._lang_covered_q("en")) if value else queryset

    def filter_lang_en_out(self, queryset, name, value: bool):
        return queryset.exclude(self._lang_covered_q("en")) if value else queryset

    def filter_lang_es_in(self, queryset, name, value: bool):
        return queryset.filter(self._lang_covered_q("es")) if value else queryset

    def filter_lang_es_out(self, queryset, name, value: bool):
        return queryset.exclude(self._lang_covered_q("es")) if value else queryset

    @staticmethod
    def _filter_csv_iexact(queryset, field: str, value: str):
        """Match one or several comma-separated values (case-insensitive)."""
        values = [v.strip() for v in value.split(",") if v.strip()]
        if not values:
            return queryset
        q = Q()
        for v in values:
            q |= Q(**{f"{field}__iexact": v})
        return queryset.filter(q)

    # ── Dynamic attribute filters (attr_<code>=value) ───────────────────────

    def filter_queryset(self, queryset):
        """Apply declared filters, then dynamic `attr_<code>` attribute filters."""
        queryset = super().filter_queryset(queryset)
        return self._apply_attribute_filters(queryset)

    def _apply_attribute_filters(self, queryset):
        attr_params = {
            key[len(_ATTR_PREFIX) :]: value
            for key, value in self.data.items()
            if key.startswith(_ATTR_PREFIX) and value not in (None, "")
        }
        if not attr_params:
            return queryset

        filterable = {
            a.code: a
            for a in AttributeRegistry.objects.filter(
                code__in=list(attr_params), is_filterable=True
            )
        }
        for code, raw in attr_params.items():
            attribute = filterable.get(code)
            if attribute is None:
                continue
            queryset = self._filter_one_attribute(queryset, attribute, raw)
        return queryset.distinct()

    @staticmethod
    def _filter_one_attribute(queryset, attribute, raw: str):
        """Filter on a single dynamic attribute value (CDC §4.1.1).

        Encoding follows `ProductAttributeValue.value` per data_type:
        booleans → true/false, numbers → numeric exact, multiselect →
        contains (any of comma-separated values), others → string exact.
        """
        base = Q(attribute_values__attribute=attribute)
        data_type = attribute.data_type
        if data_type == "boolean":
            as_bool = str(raw).lower() in {"true", "1", "yes", "oui"}
            return queryset.filter(base & Q(attribute_values__value=as_bool))
        if data_type == "number":
            try:
                num = float(raw)
            except (TypeError, ValueError):
                return queryset
            return queryset.filter(base & Q(attribute_values__value=num))

        wanted = [v.strip() for v in str(raw).split(",") if v.strip()]
        if not wanted:
            return queryset
        q = Q()
        if data_type == "multiselect":
            for v in wanted:
                q |= Q(attribute_values__value__contains=[v])
        else:
            # text / select — exact string match (select may be multi via CSV).
            for v in wanted:
                q |= Q(attribute_values__value=v)
        return queryset.filter(base & q)
