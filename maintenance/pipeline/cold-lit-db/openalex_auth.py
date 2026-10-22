"""OpenAlex API key injection (local only, never committed).

All three literature DB pipelines funnel their OpenAlex requests through two
choke points in this directory:
  - daily_update.py::fetch()          (lit-db daily, consensus daily/collect, perfmod collect)
  - rewash_smallpage.py::fetch_page_with_metrics()   (194-group rewash)

This module attaches the configured OpenAlex API key. Actual access and quota
are determined by the service and recorded response headers, not assumed here.

Key storage: ~/.config/openalex/api_key (file mode 600, single line).
The key is never printed, logged or committed; this source contains no key.

Usage:
    import openalex_auth
    url = openalex_auth.with_key(url)
"""

import os
import urllib.parse

KEY_FILE = os.path.expanduser("~/.config/openalex/api_key")

_key = None
_loaded = False


def get_key():
    """Return the configured API key, or None when absent/unreadable."""
    global _key, _loaded
    if not _loaded:
        _loaded = True
        try:
            with open(KEY_FILE, "r", encoding="utf-8") as f:
                _key = f.read().strip() or None
        except OSError:
            _key = None
    return _key


def has_key():
    return bool(get_key())


def with_key(url):
    """Append ?api_key= to an OpenAlex URL when a key is configured.

    No key file -> URL returned byte-identical (current keyless behaviour).
    Never double-injects; only touches api.openalex.org URLs.
    """
    parts = urllib.parse.urlsplit(url)
    if parts.scheme != "https" or parts.hostname != "api.openalex.org" or parts.port not in (None, 443):
        return url
    key = get_key()
    pairs = urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
    if not key or any(k.lower() == "api_key" for k, _ in pairs):
        return url
    pairs.append(("api_key", key))
    return urllib.parse.urlunsplit(parts._replace(query=urllib.parse.urlencode(pairs)))
