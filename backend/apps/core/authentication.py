from rest_framework.authentication import SessionAuthentication


class CsrfExemptSessionAuthentication(SessionAuthentication):
    """SessionAuthentication without CSRF token enforcement.

    Safe for SPA/BFF setups: the session cookie already has SameSite=Lax,
    which prevents cross-site POST attacks at the browser level.
    Requiring a separate CSRF token on top adds no security in this topology
    (browser → Next.js proxy → Django, all same origin from the browser).
    """

    def enforce_csrf(self, request):
        pass
