"""Scraper Strategy Pattern — Epic 13: Multi-Source Crawl.

Exports public API:
  get_scraper(source_url) -> BaseScraper
"""
from app.services.scrapers.factory import get_scraper

__all__ = ["get_scraper"]
