from django.urls import path

from . import views

app_name = "accounts"

urlpatterns = [
    path("users/", views.list_users, name="list-users"),
    path("users/create/", views.create_user, name="create-user"),
    path("users/<int:user_id>/", views.user_detail, name="user-detail"),
]
