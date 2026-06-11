"""Seed the 5 minimal dynamic attributes (CDC §3.3)."""

from django.db import migrations

from apps.attributes.seeds import MINIMAL_ATTRIBUTES, seed_minimal_attributes


def forwards(apps, schema_editor):
    attribute_model = apps.get_model("attributes", "AttributeRegistry")
    seed_minimal_attributes(attribute_model)


def backwards(apps, schema_editor):
    attribute_model = apps.get_model("attributes", "AttributeRegistry")
    attribute_model.objects.filter(code__in=[e["code"] for e in MINIMAL_ATTRIBUTES]).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("attributes", "0002_alter_attributeregistry_code"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
