"""``migration_report`` — final post-migration report (CDC §8.8).

Generates the cross-validation Excel workbook + a plain-text email summary, and
optionally emails it to Olivier + Yassine.

Examples
--------
    # Write the Excel report and print the email body.
    docker compose run --rm backend python manage.py migration_report

    # Also email it (recipients from MIGRATION_REPORT_RECIPIENTS or --to).
    docker compose run --rm backend python manage.py migration_report --email \\
        --to olivier@syskern.com,yassine@boldys.ai
"""

from __future__ import annotations

from typing import Any

from django.conf import settings
from django.core.mail import EmailMessage
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.data_migration.report import generate_report


class Command(BaseCommand):
    help = "Generate the final post-migration report (Excel + email summary, CDC §8.8)."

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument(
            "--output-dir",
            default=None,
            metavar="PATH",
            help="Where to write the .xlsx (default: settings MIGRATION REPORT_DIR).",
        )
        parser.add_argument(
            "--state-file",
            default=None,
            metavar="PATH",
            help="Resume checkpoint to read created/updated counts from "
            "(default: settings MIGRATION STATE_FILE).",
        )
        parser.add_argument(
            "--email",
            action="store_true",
            default=False,
            help="Email the report (recipients from --to or MIGRATION_REPORT_RECIPIENTS).",
        )
        parser.add_argument(
            "--to",
            default=None,
            metavar="A,B",
            help="Comma-separated recipient list (overrides MIGRATION_REPORT_RECIPIENTS).",
        )

    def handle(self, *args: Any, **options: Any) -> None:
        output_dir = options["output_dir"] or settings.MIGRATION["REPORT_DIR"]
        path, email_body = generate_report(
            output_dir=output_dir,
            when=timezone.localtime(),
            state_file=options["state_file"],
        )

        self.stdout.write(self.style.SUCCESS(f"Report written: {path}"))
        self.stdout.write("\n--- Email body ---\n")
        self.stdout.write(email_body)

        if options["email"]:
            self._send_email(path, email_body, options["to"])

    def _send_email(self, path, email_body: str, to_opt: str | None) -> None:
        recipients = (
            [r.strip() for r in to_opt.split(",") if r.strip()]
            if to_opt
            else list(settings.MIGRATION.get("REPORT_RECIPIENTS", []))
        )
        if not recipients:
            raise CommandError(
                "No recipients. Pass --to a@x,b@y or set MIGRATION_REPORT_RECIPIENTS."
            )

        msg = EmailMessage(
            subject="Rapport de migration Syskern",
            body=email_body,
            from_email=getattr(settings, "DEFAULT_FROM_EMAIL", "noreply@syskern.local"),
            to=recipients,
        )
        msg.attach_file(str(path))
        sent = msg.send(fail_silently=False)
        self.stdout.write(self.style.SUCCESS(f"\nEmail sent to {', '.join(recipients)} ({sent})."))
