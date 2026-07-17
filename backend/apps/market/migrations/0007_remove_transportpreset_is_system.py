"""Remove is_system and clear seeded presets — users create their own."""

from django.db import migrations


def clear_presets(apps, schema_editor):
    transport_preset_model = apps.get_model("market", "TransportPreset")
    transport_preset_model.objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ("market", "0006_transport_preset_unified"),
    ]

    operations = [
        migrations.RunPython(clear_presets, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name="transportpreset",
            name="is_system",
        ),
    ]
