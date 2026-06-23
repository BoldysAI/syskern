"""Add sale incoterm fields on Simulation and recalculation trace (CDC §6.8.3)."""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("simulations", "0003_simulation_pricing_gaps"),
    ]

    operations = [
        migrations.AddField(
            model_name="simulation",
            name="sale_incoterm",
            field=models.CharField(
                choices=[
                    ("EXW", "Ex Works"),
                    ("FCA", "Free Carrier"),
                    ("FAS", "Free Alongside Ship"),
                    ("FOB", "Free On Board"),
                    ("CFR", "Cost and Freight"),
                    ("CIF", "Cost, Insurance and Freight"),
                    ("CPT", "Carriage Paid To"),
                    ("CIP", "Carriage and Insurance Paid To"),
                    ("DAP", "Delivered At Place"),
                    ("DPU", "Delivered at Place Unloaded"),
                    ("DDP", "Delivered Duty Paid"),
                ],
                default="EXW",
                max_length=4,
            ),
        ),
        migrations.AddField(
            model_name="simulation",
            name="sale_incoterm_location",
            field=models.CharField(blank=True, default="", max_length=128),
        ),
        migrations.AddField(
            model_name="simulationrecalculation",
            name="sale_incoterm",
            field=models.CharField(
                choices=[
                    ("EXW", "Ex Works"),
                    ("FCA", "Free Carrier"),
                    ("FAS", "Free Alongside Ship"),
                    ("FOB", "Free On Board"),
                    ("CFR", "Cost and Freight"),
                    ("CIF", "Cost, Insurance and Freight"),
                    ("CPT", "Carriage Paid To"),
                    ("CIP", "Carriage and Insurance Paid To"),
                    ("DAP", "Delivered At Place"),
                    ("DPU", "Delivered at Place Unloaded"),
                    ("DDP", "Delivered Duty Paid"),
                ],
                default="EXW",
                max_length=4,
            ),
        ),
        migrations.AddField(
            model_name="simulationrecalculation",
            name="sale_incoterm_location",
            field=models.CharField(blank=True, default="", max_length=128),
        ),
    ]
