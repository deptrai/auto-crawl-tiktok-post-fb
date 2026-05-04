import pytest
from unittest.mock import patch, MagicMock

from app.services.scrapers.factory import get_scraper
from app.services.scrapers.instagram import InstagramScraper


def test_factory_returns_instagram_scraper():
    scraper = get_scraper("https://www.instagram.com/veritasium/")
    assert isinstance(scraper, InstagramScraper)

    scraper = get_scraper("https://instagram.com/p/12345/")
    assert isinstance(scraper, InstagramScraper)

    scraper = get_scraper("https://m.instagram.com/reels/123")
    assert isinstance(scraper, InstagramScraper)


@patch("app.services.scrapers.instagram._get_apify_client")
def test_extract_metadata_filters_and_maps_correctly(mock_get_client):
    mock_client = MagicMock()
    mock_get_client.return_value = mock_client

    mock_run = {"defaultDatasetId": "test-dataset-id", "status": "SUCCEEDED"}
    mock_client.actor.return_value.call.return_value = mock_run

    # Mock dataset items
    mock_dataset = MagicMock()
    mock_client.dataset.return_value = mock_dataset

    # Create mixed items (video, reels, image)
    mock_items = [
        {
            "id": "1",
            "type": "Video",
            "videoUrl": "https://cdn.instagram.com/video1.mp4",
            "caption": "Video 1 caption",
            "viewCount": 1000,
            "likesCount": 100,
            "commentsCount": 10,
            "videoDuration": 15
        },
        {
            "id": "2",
            "type": "Image",
            "displayUrl": "https://cdn.instagram.com/image1.jpg",
            "caption": "Image 1 caption"
        },
        {
            "shortCode": "abc",
            "type": "Reels",
            "videoUrl": "https://cdn.instagram.com/video2.mp4",
            "title": "Reel 2 title",
            "playCount": 5000,
            "likeCount": 500,
            "commentCount": 50,
            "videoDuration": 30
        }
    ]
    
    mock_dataset.list_items.return_value.items = mock_items

    scraper = InstagramScraper()
    result = scraper.extract_metadata("https://www.instagram.com/test/")

    entries = result.get("entries", [])
    
    # Should only return 2 items (Video and Reels)
    assert len(entries) == 2

    # Check mapping for first item
    assert entries[0]["id"] == "1"
    assert entries[0]["title"] == "Video 1 caption"
    assert entries[0]["_apify_download_url"] == "https://cdn.instagram.com/video1.mp4"
    assert entries[0]["view_count"] == 1000
    assert entries[0]["like_count"] == 100
    assert entries[0]["comment_count"] == 10
    assert entries[0]["duration"] == 15

    # Check mapping for second item (Reels)
    assert entries[1]["id"] == "abc"
    assert entries[1]["title"] == "Reel 2 title"
    assert entries[1]["_apify_download_url"] == "https://cdn.instagram.com/video2.mp4"
    assert entries[1]["view_count"] == 5000
    assert entries[1]["like_count"] == 500
    assert entries[1]["comment_count"] == 50
    assert entries[1]["duration"] == 30
