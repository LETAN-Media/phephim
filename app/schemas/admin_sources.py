from typing import List, Optional
from pydantic import BaseModel, Field


class CreateSourceSchema(BaseModel):
    movie_slug: str = Field(..., min_length=1, max_length=128, pattern=r'^[a-z0-9-]+$')
    episode_key: Optional[str] = Field(None, max_length=64, pattern=r'^[A-Za-z0-9_-]+$')
    video_url: str = Field(..., min_length=1, max_length=2048)
    platform: Optional[str] = Field(None, max_length=32)
    label: Optional[str] = Field(None, min_length=1, max_length=128)
    sort_order: int = Field(0, ge=0, le=1000)
    enabled: bool = True
    attribution: Optional[str] = Field(None, max_length=512)


class UpdateSourceSchema(BaseModel):
    video_url: Optional[str] = Field(None, min_length=1, max_length=2048)
    platform: Optional[str] = Field(None, max_length=32)
    label: Optional[str] = Field(None, min_length=1, max_length=128)
    sort_order: Optional[int] = Field(None, ge=0, le=1000)
    enabled: Optional[bool] = None
    attribution: Optional[str] = Field(None, max_length=512)


class ReorderSourceItem(BaseModel):
    id: int = Field(..., ge=1)
    sort_order: int = Field(..., ge=0, le=1000)


class ReorderSourcesSchema(BaseModel):
    sources: List[ReorderSourceItem]
