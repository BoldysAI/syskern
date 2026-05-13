from django.contrib import admin

from .models import Simulation, SimulationLine, SimulationRecalculation


class SimulationLineInline(admin.TabularInline):
    model = SimulationLine
    extra = 0
    fields = (
        "product",
        "pa_net_eur",
        "pamp_predictive_eur",
        "pr_eur",
        "pv_eur",
        "margin_override",
        "stock_purchase_mix_pct_override",
        "status",
    )
    readonly_fields = (
        "pa_net_eur",
        "pamp_predictive_eur",
        "pr_eur",
        "pv_eur",
    )
    show_change_link = True


@admin.register(Simulation)
class SimulationAdmin(admin.ModelAdmin):
    list_display = (
        "label",
        "simulation_type",
        "status",
        "is_dirty",
        "last_calculated_at",
        "created_at",
    )
    list_filter = ("simulation_type", "status", "is_dirty")
    search_fields = ("label", "project_name")
    readonly_fields = ("last_calculated_at", "created_at", "updated_at")
    inlines = [SimulationLineInline]


@admin.register(SimulationLine)
class SimulationLineAdmin(admin.ModelAdmin):
    list_display = (
        "simulation",
        "product",
        "pa_net_eur",
        "pr_eur",
        "pv_eur",
        "status",
    )
    list_filter = ("status",)
    search_fields = ("simulation__label", "product__sku_code")
    list_select_related = ("simulation", "product")


@admin.register(SimulationRecalculation)
class SimulationRecalculationAdmin(admin.ModelAdmin):
    list_display = ("simulation", "calculated_at", "trigger_type")
    list_filter = ("trigger_type",)
    date_hierarchy = "calculated_at"
    list_select_related = ("simulation",)
