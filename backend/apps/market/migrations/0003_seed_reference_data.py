"""Seed the 11 incoterms and 7 transport modes (CDC §3.3)."""

from django.db import migrations

from apps.market.seeds import INCOTERMS, TRANSPORT_MODES, seed_market_reference_data


def forwards(apps, schema_editor):
    incoterm_model = apps.get_model("market", "Incoterm")
    transport_mode_model = apps.get_model("market", "TransportMode")
    seed_market_reference_data(incoterm_model, transport_mode_model)


def backwards(apps, schema_editor):
    incoterm_model = apps.get_model("market", "Incoterm")
    transport_mode_model = apps.get_model("market", "TransportMode")
    incoterm_model.objects.filter(code__in=[e["code"] for e in INCOTERMS]).delete()
    transport_mode_model.objects.filter(code__in=[e["code"] for e in TRANSPORT_MODES]).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("market", "0002_create_incoterms"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
