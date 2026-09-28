from cv_tailor_agents.contracts.health_response import HealthResponse


def health() -> HealthResponse:
    return HealthResponse(status="ok")
