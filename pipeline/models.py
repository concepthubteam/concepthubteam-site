"""
Canonical event format — every scraper must output this.
"""
from dataclasses import dataclass, field
from typing import Optional, List


@dataclass
class VenuePayload:
    name: str
    address: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    google_place_id: Optional[str] = None


@dataclass
class PricePayload:
    min: Optional[float] = None
    max: Optional[float] = None
    currency: str = "RON"


@dataclass
class CanonicalEvent:
    source: str                     # "iabilet" | "ra" | "zilesinopti" | "eventbook" | "iesim"
    source_event_id: str            # unique id within source, e.g. "iabilet_89342"
    url: str                        # canonical event page URL
    title: str
    category: str                   # GOZI category (see normalize.map_category)
    start_at: str                   # ISO 8601 with tz: "2026-05-18T22:00:00+02:00"
    venue: VenuePayload

    description: Optional[str] = None
    end_at: Optional[str] = None
    price: PricePayload = field(default_factory=PricePayload)
    is_free: bool = False
    ticket_url: Optional[str] = None
    images: List[str] = field(default_factory=list)
    tags: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "source":          self.source,
            "source_event_id": self.source_event_id,
            "url":             self.url,
            "title":           self.title,
            "description":     self.description,
            "category":        self.category,
            "start_at":        self.start_at,
            "end_at":          self.end_at,
            "venue": {
                "name":            self.venue.name,
                "address":         self.venue.address,
                "lat":             self.venue.lat,
                "lng":             self.venue.lng,
                "google_place_id": self.venue.google_place_id,
            },
            "price": {
                "min":      self.price.min,
                "max":      self.price.max,
                "currency": self.price.currency,
            },
            "is_free":    self.is_free,
            "ticket_url": self.ticket_url,
            "images":     self.images,
            "tags":       self.tags,
        }
