"""Custom lint: the pricing engine must never use `float` (CDC §6.5).

Money is `Decimal` everywhere (AGENTS.md §5 rule 1).  Ruff has no built-in
rule to forbid floating-point, so we enforce it with a dedicated AST scan of
every module in `apps.simulations.services.engine`: any float literal (e.g.
`0.06`) or `float(...)` call fails the suite.  Decimals must be built from
strings/ints (`Decimal("0.06")`, `to_decimal(...)`).
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from apps.simulations.services import engine

ENGINE_DIR = Path(engine.__file__).parent
ENGINE_FILES = sorted(ENGINE_DIR.glob("*.py"))


def _float_violations(source: str) -> list[tuple[int, str]]:
    """Return (lineno, kind) for every float literal or `float()` call."""
    tree = ast.parse(source)
    violations: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, float):
            violations.append((node.lineno, f"float literal {node.value!r}"))
        elif (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "float"
        ):
            violations.append((node.lineno, "float() call"))
    return violations


def test_engine_package_has_python_files():
    """Guard against the glob silently matching nothing (false green)."""
    assert ENGINE_FILES, f"No engine modules found under {ENGINE_DIR}"


@pytest.mark.parametrize("path", ENGINE_FILES, ids=lambda p: p.name)
def test_engine_module_uses_no_float(path: Path):
    violations = _float_violations(path.read_text(encoding="utf-8"))
    assert not violations, (
        f"{path.name} uses float (forbidden — use Decimal): "
        + ", ".join(f"L{line}: {kind}" for line, kind in violations)
    )
