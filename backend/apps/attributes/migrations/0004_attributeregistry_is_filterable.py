"""Add `is_filterable` flag to the attribute registry (CDC §4.1.1)."""

from __future__ import annotations

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("attributes", "0003_seed_minimal_attributes"),
    ]

    operations = [
        migrations.AddField(
            model_name="attributeregistry",
            name="is_filterable",
            field=models.BooleanField(default=False),
        ),
    ]
