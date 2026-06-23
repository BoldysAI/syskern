"""Migration up/down tests for pricing model gaps."""

from __future__ import annotations

from django.core.management import call_command
from django.db import connection
from django.test import TransactionTestCase


class SimulationMigrationTests(TransactionTestCase):
    def test_0003_forward_and_reverse(self) -> None:
        call_command("migrate", "simulations", "0002", verbosity=0)
        call_command("migrate", "simulations", "0003", verbosity=0)

        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT 1 FROM pg_indexes WHERE indexname = %s",
                ["idx_simulations_client_ids_gin"],
            )
            assert cursor.fetchone() is not None

            cursor.execute(
                "SELECT 1 FROM pg_proc WHERE proname = %s",
                ["simulations_guard_finalized"],
            )
            assert cursor.fetchone() is not None

            cursor.execute(
                "SELECT 1 FROM pg_proc WHERE proname = %s",
                ["simulation_lines_guard_finalized_parent"],
            )
            assert cursor.fetchone() is not None

        call_command("migrate", "simulations", "0002", verbosity=0)


class MarketMigrationTests(TransactionTestCase):
    def test_0004_forward_and_reverse(self) -> None:
        call_command("migrate", "market", "0003", verbosity=0)
        call_command("migrate", "market", "0004", verbosity=0)

        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'market_parameters' AND column_name = 'source'
                """
            )
            assert cursor.fetchone() is not None

            cursor.execute(
                "SELECT 1 FROM pg_indexes WHERE indexname = %s",
                ["idx_market_params_type_active"],
            )
            assert cursor.fetchone() is not None

        call_command("migrate", "market", "0003", verbosity=0)
