from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="profile",
            name="locale",
            field=models.CharField(
                blank=True,
                choices=[("fr", "Français"), ("en", "English")],
                default="",
                help_text="Interface language. Empty follows the deployment default.",
                max_length=16,
            ),
        ),
    ]
