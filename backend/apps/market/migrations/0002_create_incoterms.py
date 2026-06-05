import uuid

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("market", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="Incoterm",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4, editable=False, primary_key=True, serialize=False
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("code", models.CharField(max_length=4, unique=True)),
                (
                    "label",
                    models.JSONField(help_text='Multilingual {"fr": ..., "en": ..., "es": ...}'),
                ),
                ("display_order", models.IntegerField(default=0)),
                ("is_active", models.BooleanField(default=True)),
            ],
            options={
                "db_table": "incoterms",
                "ordering": ["display_order", "code"],
            },
        ),
    ]
