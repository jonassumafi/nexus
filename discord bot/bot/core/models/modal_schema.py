from typing import Optional

from pydantic import BaseModel


class ModalFieldSchema(BaseModel):
    label: str
    placeholder: Optional[str] = None
    required: bool = True
    min_length: Optional[int] = 1
    max_length: Optional[int] = 300
    style: int = 1  # 1 = short, 2 = paragraph
    default: Optional[str] = None
    custom_id: Optional[str] = None

    class Config:
        arbitrary_types_allowed = True