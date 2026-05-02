"""Unit tests cho Story 10.2: Caption Đa Ngôn Ngữ."""
from app.services.ai_generator import _build_system_instruction


def test_language_instruction_vi():
    prompt = _build_system_instruction(target_language="vi")
    assert "Tiếng Việt" in prompt
    assert "English" not in prompt


def test_language_instruction_en():
    prompt = _build_system_instruction(target_language="en")
    assert "English" in prompt
    assert "Tiếng Việt" not in prompt


def test_language_instruction_auto():
    prompt = _build_system_instruction(target_language="auto")
    assert "Detect the language" in prompt
    assert "Tiếng Việt" not in prompt
    assert "English" not in prompt


def test_combined_brand_voice_and_language():
    prompt = _build_system_instruction(
        brand_voice="Vui nhộn",
        brand_voice_preset="gen-z",
        target_language="vi"
    )
    assert "Gen Z thịnh hành" in prompt
    assert "Vui nhộn" in prompt
    assert "Tiếng Việt" in prompt
    assert "<custom_voice>" in prompt
