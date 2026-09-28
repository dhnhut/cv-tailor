from cv_tailor_agents.health import health


def test_health_returns_ok() -> None:
    assert health().model_dump() == {"status": "ok"}
