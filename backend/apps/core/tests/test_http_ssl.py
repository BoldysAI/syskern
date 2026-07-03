from apps.core.http_ssl import httpx_verify


def test_httpx_verify_disabled():
    assert httpx_verify(False) is False


def test_httpx_verify_enabled_uses_certifi():
    bundle = httpx_verify(True)
    assert bundle is True or (isinstance(bundle, str) and bundle.endswith(".pem"))
