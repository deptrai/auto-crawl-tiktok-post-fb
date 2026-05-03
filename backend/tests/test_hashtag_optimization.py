"""Unit tests cho Story 10.3: Tối Ưu Hashtag Tự Động."""
from app.services.ai_generator import _merge_hashtags


def test_merge_hashtags_deduplicates_case_insensitive():
    ai_caption = "Hello #TikTok #xuhuong #ViRaL"
    original = "Nội dung cũ #tiktok #giaitri"
    
    # original_tags: #tiktok, #giaitri
    # ai_tags: #TikTok, #xuhuong, #ViRaL
    # Expected deduplicated order: #tiktok, #giaitri, #xuhuong, #ViRaL
    result = _merge_hashtags(ai_caption, original)
    
    assert "#tiktok" in result
    assert "#giaitri" in result
    assert "#xuhuong" in result
    assert "#ViRaL" in result
    assert result.lower().count("#tiktok") == 1
    assert result.startswith("Hello")


def test_merge_hashtags_limits_to_30():
    ai_caption = " ".join([f"#new{i}" for i in range(20)])
    original = " ".join([f"#old{i}" for i in range(20)])
    
    result = _merge_hashtags(ai_caption, original)
    tags = [word for word in result.split() if word.startswith("#")]
    
    assert len(tags) == 30
    # Original tags should be prioritized
    assert "#old0" in tags
    assert "#old19" in tags
    # AI tags should fill the rest
    assert "#new0" in tags
    assert "#new9" in tags
    assert "#new10" not in tags


def test_merge_hashtags_graceful_with_no_tags():
    ai_caption = "This is a simple caption without tags"
    original = "Another simple text"
    
    result = _merge_hashtags(ai_caption, original)
    assert result == "This is a simple caption without tags"


def test_merge_hashtags_graceful_with_empty_original():
    ai_caption = "New #tag"
    original = ""
    
    result = _merge_hashtags(ai_caption, original)
    assert "New" in result
    assert "#tag" in result


def test_merge_hashtags_graceful_with_empty_ai_caption():
    ai_caption = ""
    original = "#oldtag"
    
    result = _merge_hashtags(ai_caption, original)
    assert "#oldtag" in result
