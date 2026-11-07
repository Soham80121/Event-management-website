"""Read the built-in event catalogue from js/events.js (the single source of
truth) so the server can validate events the same way the pages do.

Extracted: the category list, and for each built-in event its id, title,
category, cover image (src + alt) and registration status. Nothing is
duplicated by hand; tests/test_platform.py cross-checks this reader against
Node's own evaluation of js/events.js when Node is installed.
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
UNSPLASH = "https://images.unsplash.com/photo-"
STR = r"'((?:[^'\\]|\\.)*)'"


def _unquote(s: str) -> str:
    return re.sub(r"\\(.)", r"\1", s)


class Catalogue:
    def __init__(self, source: str):
        m = re.search(r"var CATEGORIES = Object\.freeze\(\[(.*?)\]\)", source, re.S)
        if not m:
            raise ValueError("js/events.js: CATEGORIES not found")
        self.categories = [_unquote(x) for x in re.findall(STR, m.group(1))]
        m = re.search(r"var EVENTS = \[(.*?)\n  \];", source, re.S)
        if not m:
            raise ValueError("js/events.js: EVENTS not found")
        self.events = {}
        for block in re.split(r"\n    \{", m.group(1))[1:]:
            def field(pattern):
                f = re.search(pattern, block, re.S)
                return _unquote(f.group(1)) if f else None
            ev = {
                "id": field(r"\bid: " + STR),
                "title": field(r"\btitle: " + STR),
                "category": field(r"\bcategory: " + STR),
                "image": {"src": UNSPLASH + (field(r"image: \{ src: unsplash\(" + STR) or ""),
                          "alt": field(r"image: \{[^}]*?\balt: " + STR)},
                "registration": field(r"registration: \{ status: " + STR),
            }
            if not all([ev["id"], ev["title"], ev["category"], ev["image"]["alt"], ev["registration"]]):
                raise ValueError("js/events.js: could not read an event near: " + block[:60])
            self.events[ev["id"]] = ev
        if not self.events or not self.categories:
            raise ValueError("js/events.js: empty catalogue")
        # cover photos a host may choose: each catalogue photo once (as hosting.coverImages())
        seen, self.covers = set(), {}
        for ev in self.events.values():
            src = ev["image"]["src"]
            if src not in seen:
                seen.add(src)
                self.covers[src] = ev["image"]["alt"]

    def is_builtin(self, event_id: str) -> bool:
        return event_id in self.events


def load(root: pathlib.Path = ROOT) -> Catalogue:
    return Catalogue((root / "js" / "events.js").read_text(encoding="utf-8"))
