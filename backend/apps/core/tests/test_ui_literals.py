"""Views and serializers must not raise a user-facing error from a string literal (story 7.3)."""

from __future__ import annotations

import ast
from pathlib import Path

APPS = Path(__file__).resolve().parents[2]
_RAISE_NAMES = {"ValidationError", "PermissionDenied", "Http404", "NotFound"}
_SCANNED = {"views.py", "serializers.py"}


def _literal_texts(node: ast.AST) -> list[str]:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return [node.value]
    if isinstance(node, ast.JoinedStr):
        return [
            part.value
            for part in node.values
            if isinstance(part, ast.Constant) and isinstance(part.value, str)
        ]
    if isinstance(node, ast.Dict):
        texts: list[str] = []
        for value in node.values:
            texts.extend(_literal_texts(value))
        return texts
    return []


def _call_name(func: ast.expr) -> str:
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return func.attr
    return ""


def test_views_and_serializers_have_no_literal_user_errors() -> None:
    hits: list[str] = []
    for path in APPS.rglob("*.py"):
        if "migrations" in path.parts or path.name not in _SCANNED:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or _call_name(node.func) not in _RAISE_NAMES:
                continue
            args = list(node.args)
            for keyword in node.keywords:
                if keyword.arg in {None, "detail"}:
                    args.append(keyword.value)
            for arg in args:
                hits.extend(
                    f"{path.relative_to(APPS)}:{node.lineno}: {text[:80]}"
                    for text in _literal_texts(arg)
                    if any(char.isalpha() for char in text)
                )
    assert hits == []
