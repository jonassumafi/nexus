from typing import Optional, Callable

from discord import ButtonStyle
from pydantic import BaseModel, field_validator


class ButtonSchema(BaseModel):
    label : str
    style: ButtonStyle = ButtonStyle.primary
    emoji : Optional[str] = None
    custom_id: Optional[str] = None
    disabled: bool =  False
    callback : Optional[Callable] = None

    @field_validator('label')
    @classmethod
    def label_bot_empty(cls, v:str):
        if not v.strip():
            raise ValueError("Button label cannot be empty")
        return v

    class Config:
        arbitrary_types_allowed = True
