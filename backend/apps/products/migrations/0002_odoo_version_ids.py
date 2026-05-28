import django.db.models.fields


from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("products", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="product",
            name="odoo_v16_id",
            field=models.IntegerField(blank=True, null=True, unique=True),
        ),
        migrations.AddField(
            model_name="product",
            name="odoo_v19_id",
            field=models.IntegerField(blank=True, null=True, unique=True),
        ),
        migrations.AddIndex(
            model_name="product",
            index=models.Index(fields=["odoo_v16_id"], name="idx_products_odoo_v16"),
        ),
        migrations.AddIndex(
            model_name="product",
            index=models.Index(fields=["odoo_v19_id"], name="idx_products_odoo_v19"),
        ),
    ]
