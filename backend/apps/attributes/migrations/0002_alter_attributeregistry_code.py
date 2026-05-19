# Generated manually — CDC §4.5: attribute code max 64 chars.
#
# Postgres converts text → varchar(64) with a short AccessShareLock.
# Acceptable in pre-production; schedule for a maintenance window in production.

import django.core.validators
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("attributes", "0001_initial"),
    ]

    operations = [
        migrations.AlterField(
            model_name="attributeregistry",
            name="code",
            field=models.CharField(
                max_length=64,
                unique=True,
                validators=[
                    django.core.validators.RegexValidator(
                        message="Attribute code must be snake_case (lowercase, digits, underscores).",
                        regex="^[a-z][a-z0-9_]*$",
                    )
                ],
            ),
        ),
    ]
