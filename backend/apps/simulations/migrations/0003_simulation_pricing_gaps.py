"""Pricing model gaps (CDC §3.2 + §6.9.10).

Adds odoo_snapshot_at, effective_* on lines, indexes, status CHECK,
and PostgreSQL triggers guarding finalized simulations.
"""

from __future__ import annotations

import django.contrib.postgres.indexes
from django.db import migrations, models

_TRIGGER_FORWARD = """
CREATE OR REPLACE FUNCTION simulations_guard_finalized() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status IN ('finalized', 'archived') THEN
            RAISE EXCEPTION 'Cannot delete finalized or archived simulations';
        END IF;
        RETURN OLD;
    END IF;

    IF OLD.status = 'finalized' THEN
        IF NEW.status = 'archived' THEN
            IF NEW.label IS DISTINCT FROM OLD.label
               OR NEW.simulation_type IS DISTINCT FROM OLD.simulation_type
               OR NEW.client_ids IS DISTINCT FROM OLD.client_ids
               OR NEW.project_name IS DISTINCT FROM OLD.project_name
               OR NEW.market_params IS DISTINCT FROM OLD.market_params
               OR NEW.calculation_chain IS DISTINCT FROM OLD.calculation_chain
               OR NEW.stock_purchase_mix_pct IS DISTINCT FROM OLD.stock_purchase_mix_pct
               OR NEW.symea_margin_rate IS DISTINCT FROM OLD.symea_margin_rate
               OR NEW.syskern_margin_rate IS DISTINCT FROM OLD.syskern_margin_rate
               OR NEW.last_calculated_at IS DISTINCT FROM OLD.last_calculated_at
               OR NEW.odoo_snapshot_at IS DISTINCT FROM OLD.odoo_snapshot_at
               OR NEW.is_dirty IS DISTINCT FROM OLD.is_dirty
               OR NEW.created_at IS DISTINCT FROM OLD.created_at
            THEN
                RAISE EXCEPTION 'Can only change status when archiving a finalized simulation';
            END IF;
            RETURN NEW;
        END IF;
        IF NEW.status = 'finalized' THEN
            RAISE EXCEPTION 'Finalized simulations cannot be modified';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER simulations_guard_finalized_trigger
BEFORE UPDATE OR DELETE ON simulations
FOR EACH ROW EXECUTE FUNCTION simulations_guard_finalized();

CREATE OR REPLACE FUNCTION simulation_lines_guard_finalized_parent() RETURNS trigger AS $$
DECLARE
    parent_status text;
    sim_id uuid;
BEGIN
    IF TG_OP = 'DELETE' THEN
        sim_id := OLD.simulation_id;
    ELSE
        sim_id := NEW.simulation_id;
    END IF;

    SELECT status INTO parent_status FROM simulations WHERE id = sim_id;
    IF parent_status = 'finalized' THEN
        RAISE EXCEPTION 'Cannot modify lines of a finalized simulation';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER simulation_lines_guard_finalized_parent_trigger
BEFORE INSERT OR UPDATE OR DELETE ON simulation_lines
FOR EACH ROW EXECUTE FUNCTION simulation_lines_guard_finalized_parent();
"""

_TRIGGER_REVERSE = """
DROP TRIGGER IF EXISTS simulation_lines_guard_finalized_parent_trigger ON simulation_lines;
DROP FUNCTION IF EXISTS simulation_lines_guard_finalized_parent();
DROP TRIGGER IF EXISTS simulations_guard_finalized_trigger ON simulations;
DROP FUNCTION IF EXISTS simulations_guard_finalized();
"""


class Migration(migrations.Migration):
    dependencies = [
        ("simulations", "0002_alter_simulation_symea_margin_rate_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="simulation",
            name="odoo_snapshot_at",
            field=models.DateTimeField(
                blank=True,
                help_text="Odoo data freshness at the last global recalculation.",
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="simulationline",
            name="effective_margin_rate",
            field=models.DecimalField(blank=True, decimal_places=4, max_digits=6, null=True),
        ),
        migrations.AddField(
            model_name="simulationline",
            name="effective_mix_pct",
            field=models.IntegerField(blank=True, null=True),
        ),
        migrations.AddIndex(
            model_name="simulation",
            index=models.Index(
                fields=["simulation_type", "status"],
                name="idx_simulations_type_status",
            ),
        ),
        migrations.AddIndex(
            model_name="simulation",
            index=django.contrib.postgres.indexes.GinIndex(
                fields=["client_ids"],
                name="idx_simulations_client_ids_gin",
            ),
        ),
        migrations.AddConstraint(
            model_name="simulation",
            constraint=models.CheckConstraint(
                condition=models.Q(("status__in", ["draft", "finalized", "archived"])),
                name="simulations_status_valid",
            ),
        ),
        migrations.RunSQL(sql=_TRIGGER_FORWARD, reverse_sql=_TRIGGER_REVERSE),
    ]
