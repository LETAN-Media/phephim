from pydantic import BaseModel, ConfigDict, Field

class WatchProgress(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    movie_slug: str = Field(min_length=1, max_length=100, pattern=r'^[a-z0-9-]+$')
    episode: str | None = Field(default=None, min_length=1, max_length=64, pattern=r'^[A-Za-z0-9_-]+$')
    position_seconds: float = Field(ge=0, le=604800)
