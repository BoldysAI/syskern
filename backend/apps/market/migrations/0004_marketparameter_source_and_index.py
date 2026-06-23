"""Add source field and active-parameter index on market_parameters (CDC §3.2)."""

from __future__ import annotations

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("market", "0003_seed_reference_data"),
    ]

    operations = [
        migrations.AddField(
            model_name="marketparameter",
            name="source",
            field=models.CharField(
                blank=True,
                default="",
                help_text="Data source, e.g. LME, BCE, manual.",
                max_length=32,
            ),
        ),
        migrations.AddIndex(
            model_name="marketparameter",
            index=models.Index(
                fields=["parameter_type", "is_active"],
                name="idx_market_params_type_active",
            ),
        ),
    ]
