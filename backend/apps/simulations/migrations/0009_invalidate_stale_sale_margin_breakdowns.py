"""Mark draft lines dirty when sale breakdown still has margin after PV transports."""

from __future__ import annotations

from django.db import migrations


def _is_syskern_margin_step(step: dict) -> bool:
    module = step.get("module") or ""
    if module == "syskern_margin":
        return True
    if module == "margin":
        return (step.get("metadata") or {}).get("label") == "syskern"
    return False


def _sale_margin_before_transport_stale(breakdown: dict | None) -> bool:
    if not breakdown:
        return False
    steps = (breakdown.get("sale") or {}).get("steps") or []
    if len(steps) < 2:
        return False
    margin_idx = next((i for i, s in enumerate(steps) if _is_syskern_margin_step(s)), -1)
    transport_idx = next((i for i, s in enumerate(steps) if s.get("module") == "transport"), -1)
    if margin_idx < 0 or transport_idx < 0:
        return False
    return margin_idx > transport_idx


def mark_stale_sale_margin_lines(apps, schema_editor) -> None:
    Simulation = apps.get_model("simulations", "Simulation")
    SimulationLine = apps.get_model("simulations", "SimulationLine")

    stale_simulation_ids: set = set()
    for line in SimulationLine.objects.filter(simulation__status="draft").iterator(chunk_size=500):
        breakdown = line.calculation_breakdown or {}
        if not breakdown or not _sale_margin_before_transport_stale(breakdown):
            continue
        line.status = "dirty"
        line.save(update_fields=["status"])
        stale_simulation_ids.add(line.simulation_id)

    if stale_simulation_ids:
        Simulation.objects.filter(pk__in=stale_simulation_ids, status="draft").update(is_dirty=True)


class Migration(migrations.Migration):
    dependencies = [
        ("simulations", "0008_simulationline_force_manual_mix_and_more"),
    ]

    operations = [
        migrations.RunPython(mark_stale_sale_margin_lines, migrations.RunPython.noop),
    ]
