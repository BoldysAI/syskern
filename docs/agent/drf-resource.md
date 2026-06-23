# docs/agent/drf-resource.md — Ajouter une ressource DRF

> Playbook step-by-step. Règles transverses → `/AGENTS.md`. Conventions Django → `backend.md`.
> Référence : `apps/products/` (modèle canonique de toute ressource CRUD).

## Ordre d'exécution

```
model → makemigrations → serializers → views → urls → admin → filters (si besoin) → tests
```
**Propose un plan** (plan-mode) avant de coder — surtout si l'app n'existe pas encore.

---

## 1. Modèle (`models.py`)

```python
""" (CDC §X.Y)."""
from __future__ import annotations
from apps.core.models import BaseModel, Currency  # utilise core, ne recrée pas les enums

class MyResource(BaseModel):           # UUID PK + created_at/updated_at via BaseModel
    # ─── Section comment style ────────────────────────────────────────────
    name = models.CharField(max_length=255)
    amount = models.DecimalField(max_digits=12, decimal_places=4, ...)  # argent = Decimal
    is_active = models.BooleanField(default=True)                       # soft-delete standard
    
    class Meta:
        db_table = "my_resources"               # toujours explicite
        ordering = ["name"]
        indexes = [
            models.Index(fields=["name"], name="idx_my_resources_name"),  # nom : idx__
        ]
        # UniqueConstraint partielle (partielle = condition=Q(...)  → partial index Postgres)
        constraints = [
            models.UniqueConstraint(
                fields=["product"],
                condition=models.Q(is_active=True),
                name="one_active__per_",              # convention de nom
            ),
        ]
    
    def __str__(self) -> str:           # toujours défini
        return self.name
```

**Gotchas modèles :**
- `TextChoices` locaux à l'app si mono-usage ; `Currency` / `Language` depuis `core` si partagés.
- Champs texte optionnels : `blank=True, default=""` (pas `null=True` pour les CharField).
- Champs numériques optionnels : `null=True, blank=True`.
- `validators=[MinValueValidator(0)]` sur DecimalField/IntegerField contraints.
- Après toute modification : `makemigrations` + **commit les migrations**.

---

## 2. Serializers (`serializers.py`)

**Trois serializers pour toute ressource CRUD non triviale :**

```python
"""Serializers for  (CDC §X)."""
from __future__ import annotations
from rest_framework import serializers
from .models import MyResource

# ── LIST : compact, table/catalogue ──────────────────────────────────────────
class MyResourceListSerializer(serializers.ModelSerializer):
    computed_field = serializers.SerializerMethodField()  # O(1) si prefetch fait en amont

    class Meta:
        model = MyResource
        fields = ("id", "name", "is_active", "computed_field", "updated_at")

    def get_computed_field(self, obj): ...

# ── DETAIL : payload complet + objets imbriqués ───────────────────────────────
class MyResourceDetailSerializer(serializers.ModelSerializer):
    children = ChildSerializer(many=True, read_only=True)  # nested via related_name

    class Meta:
        model = MyResource
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")  # + tout champ sync externe

# ── WRITE : create/update, sans imbrication, avec validation CDC ──────────────
class MyResourceWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = MyResource
        exclude = ("created_at", "updated_at")   # exclude > fields="__all__" pour le write
        read_only_fields = ("id",)

    def validate(self, attrs: dict) -> dict:
        """Règles croisées du CDC §X.Y."""
        # Pattern : gère create ET update (self.instance peut être None)
        field_a = attrs.get("field_a", getattr(self.instance, "field_a", None))
        if field_a and not attrs.get("field_b"):
            raise serializers.ValidationError({"field_b": "Requis quand field_a est vrai."})
        return attrs
```

**Ressource simple** (pas de variation list/detail) → un seul `ModelSerializer` avec `fields` tuple explicite et `read_only_fields = ("id", "created_at", "updated_at")`.

---

## 3. ViewSet (`views.py`)

```python
"""DRF views for  (CDC §X.Y)."""
from __future__ import annotations
import uuid as _uuid_module
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from django.shortcuts import get_object_or_404

class MyResourceViewSet(viewsets.ModelViewSet):
    queryset = MyResource.objects.all().select_related(...).prefetch_related(...)
    filterset_class = MyResourceFilter        # si filtrage
    search_fields = ("name", "code")
    ordering_fields = ("name", "updated_at")
    ordering = ("name",)

    # ── Sélection du serializer par action ────────────────────────────────
    def get_serializer_class(self):
        if self.action == "list":
            return MyResourceListSerializer
        if self.action in {"create", "update", "partial_update"}:
            return MyResourceWriteSerializer
        return MyResourceDetailSerializer

    # ── Lookup UUID OU clé naturelle (si applicable) ─────────────────────
    def get_object(self):
        pk = self.kwargs["pk"]
        try:
            _uuid_module.UUID(pk)
        except ValueError:
            obj = get_object_or_404(MyResource, natural_key=pk)
            self.kwargs["pk"] = str(obj.pk)
        return super().get_object()

    # ── Hooks perform_* ───────────────────────────────────────────────────
    def perform_destroy(self, instance) -> None:
        """Soft-delete (CDC §X) — ne jamais hard-delete."""
        instance.is_active = False
        instance.save(update_fields=["is_active", "updated_at"])  # update_fields = perf

    def perform_create(self, serializer) -> None:
        instance = serializer.save()
        self._dispatch_async(instance)      # push Odoo ou autre I/O → Celery

    def perform_update(self, serializer) -> None:
        instance = serializer.save()
        self._dispatch_async(instance)

    @staticmethod
    def _dispatch_async(obj) -> None:
        from apps.odoo_sync.tasks import push_something_task  # import tardif — garde vue légère
        push_something_task.delay(str(obj.pk))

    # ── Actions custom ────────────────────────────────────────────────────
    @action(detail=True, methods=["post"], url_path="activate")
    def activate(self, request, pk=None):
        """Action synchrone simple → 200."""
        obj = self.get_object()
        obj.is_active = True
        obj.save(update_fields=["is_active", "updated_at"])
        return Response(MyResourceDetailSerializer(obj).data)

    @action(detail=False, methods=["post"], url_path="export")
    def export(self, request):
        """Action async longue → 202 + task_id. Client poll /api/tasks/{id}/."""
        from .tasks import export_task
        result = export_task.delay(request.query_params.dict())
        return Response({"task_id": result.id, "status": "PENDING"}, status=status.HTTP_202_ACCEPTED)
```

---

## 4. URLs (`urls.py`)

```python
from django.urls import include, path
from rest_framework.routers import DefaultRouter
from . import views

app_name = ""                              # namespace obligatoire

router = DefaultRouter()
router.register(r"", views.MyResourceViewSet, basename="")

urlpatterns = [
    path("", include(router.urls)),
    path("extra/lookup", views.ExtraView.as_view(), name="extra-lookup"),  # APIView non-CRUD
]
```

Brancher dans `config/urls.py` : `path("api/", include("<app>.urls"))`.

---

## 5. FilterSet (`filters.py`, si filtrage catalogue/liste)

```python
"""Filters for  (CDC §X)."""
from __future__ import annotations
import django_filters as filters
from django.db.models import Q
from .models import MyResource

class MyResourceFilter(filters.FilterSet):
    name = filters.CharFilter(field_name="name", lookup_expr="icontains")
    
    # Multi-valeur comma-separated → méthode custom
    category = filters.CharFilter(method="filter_category")

    class Meta:
        model = MyResource
        fields = ["name", "is_active"]

    def filter_category(self, queryset, name, value: str):
        values = [v.strip() for v in value.split(",") if v.strip()]
        if not values:
            return queryset
        q = Q()
        for v in values:
            q |= Q(category__iexact=v)
        return queryset.filter(q)
```

---

## 6. Tests (`tests/test_<app>_api.py`)

```python
"""Integration tests for  API (CDC §X.Y).

Coverage:
  - 
"""
from __future__ import annotations
import pytest
from rest_framework.test import APIClient
from .models import MyResource

pytestmark = pytest.mark.django_db   # toute la classe/module utilise la DB

# ── Fixtures ──────────────────────────────────────────────────────────────────
@pytest.fixture()
def client() -> APIClient:
    return APIClient()              # AllowAny en settings.local → pas besoin de force_authenticate

@pytest.fixture()
def resource() -> MyResource:
    return MyResource.objects.create(name="Test", ...)   # direct .objects.create() ou factory-boy

# ── Classes de test par comportement (pas par endpoint) ─────────────────────
class TestMyResourceLookup:
    def test_get_by_uuid_returns_200(self, client, resource):
        resp = client.get(f"/api//{resource.pk}/")
        assert resp.status_code == 200
        assert resp.data["name"] == resource.name

    def test_unknown_uuid_returns_404(self, client):
        import uuid
        resp = client.get(f"/api//{uuid.uuid4()}/")
        assert resp.status_code == 404

class TestMyResourceValidation:
    def test_cross_field_rule_rejected(self, client):
        resp = client.post("/api//", {"field_a": True}, format="json")
        assert resp.status_code == 400
        assert "field_b" in resp.data
```

**Conventions tests :**
- Un fichier = une app. Classes = un comportement/feature (pas un endpoint).
- `APIClient()` sans auth (local settings = `AllowAny`).
- `assert resp.status_code == X` avant `assert resp.data[...]`.
- Teste les règles CDC explicitement (validation croisée, soft-delete, contraintes).

---

## Checklist de complétion

- [ ] Modèle : `BaseModel`, `db_table`, indexes nommés, `__str__`, `from __future__ import annotations`
- [ ] `makemigrations` + migrations committées
- [ ] 3 serializers (List/Detail/Write) ou 1 si simple ; `validate()` pour les règles CDC
- [ ] ViewSet : `get_serializer_class`, `perform_destroy` soft-delete, `update_fields` dans `save()`
- [ ] URLs : `app_name`, `DefaultRouter`, branchement dans `config/urls.py`
- [ ] FilterSet si filtrage catalogue
- [ ] Admin enregistré dans `admin.py`
- [ ] Tests : un fichier, classes par comportement, couvre les règles CDC touchées
- [ ] `ruff check && mypy && pytest` verts
