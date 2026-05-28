from django.urls import path

from . import views

app_name = "core"

urlpatterns = [
    path("auth/login", views.login_view, name="login"),
    path("auth/logout", views.logout_view, name="logout"),
    path("auth/session", views.session_view, name="session"),
    path("tasks/<str:task_id>/", views.task_status, name="task-status"),
]
