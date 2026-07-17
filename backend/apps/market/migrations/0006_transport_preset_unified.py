"""Drop chain_role — transport presets are shared across PA and PV chains."""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("market", "0005_transport_presets"),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="transportpreset",
            name="uniq_transport_preset_name_role",
        ),
        migrations.AlterModelOptions(
            name="transportpreset",
            options={"ordering": ["display_order", "name"]},
        ),
        migrations.RemoveField(
            model_name="transportpreset",
            name="chain_role",
        ),
        migrations.AlterField(
            model_name="transportpreset",
            name="name",
            field=models.CharField(max_length=128, unique=True),
        ),
    ]
