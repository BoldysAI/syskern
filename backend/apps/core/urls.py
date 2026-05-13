from django.urls import path

from . import views

app_name = "core"

urlpatterns = [
    path("auth/login", views.login, name="login"),
    path("auth/logout", views.logout, name="logout"),
    path("auth/session", views.session, name="session"),
]
