"""Mark (and optionally recalculate) simulations with outdated sale-margin ordering."""

from __future__ import annotations

from django.core.management.base import BaseCommand

from apps.simulations.models import Simulation
from apps.simulations.services.pricing_staleness import invalidate_stale_sale_margin_lines
from apps.simulations.services.runner import run_simulation


class Command(BaseCommand):
    help = (
        "Mark draft simulation lines dirty when their PV breakdown still applies "
        "Syskern margin after transports (pre–Feedback 1 order). "
        "Use --recalculate to rerun the pricing engine on affected draft simulations."
    )

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report counts without writing to the database.",
        )
        parser.add_argument(
            "--recalculate",
            action="store_true",
            help="After marking dirty, run run_simulation on each affected draft simulation.",
        )

    def handle(self, *args, **options) -> None:
        dry_run: bool = options["dry_run"]
        recalculate: bool = options["recalculate"]

        if dry_run:
            self.stdout.write(self.style.WARNING("Mode dry-run — aucune écriture."))

        stats = invalidate_stale_sale_margin_lines(dry_run=dry_run)
        self.stdout.write(
            f"Lignes obsolètes détectées : {stats['lines_stale']} · "
            f"Simulations marquées dirty : {stats['simulations_marked_dirty']}"
        )

        if not recalculate or dry_run or stats["lines_stale"] == 0:
            if recalculate and dry_run:
                self.stdout.write("Relancez sans --dry-run pour recalculer.")
            return

        sim_ids = (
            Simulation.objects.filter(status="draft", is_dirty=True)
            .order_by("created_at")
            .values_list("pk", flat=True)
        )
        ok = 0
        errors = 0
        for sim_id in sim_ids:
            sim = Simulation.objects.get(pk=sim_id)
            try:
                run_simulation(sim)
                ok += 1
                self.stdout.write(self.style.SUCCESS(f"Recalculé : {sim.label} ({sim.pk})"))
            except Exception as exc:
                errors += 1
                self.stderr.write(self.style.ERROR(f"Échec {sim.label} ({sim.pk}) : {exc}"))

        self.stdout.write(f"Recalcul terminé — OK : {ok}, erreurs : {errors}")
        if errors:
            self.stdout.write(
                self.style.WARNING(
                    "Les simulations finalisées ne peuvent pas être recalculées "
                    "(résultats figés à la finalisation)."
                )
            )
