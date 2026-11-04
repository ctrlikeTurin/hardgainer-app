from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class OnboardingIn(BaseModel):
    age: int = Field(ge=14, le=90)
    sex: Literal["male", "female"]  # selects the Mifflin-St Jeor constant only
    height_cm: float = Field(ge=120, le=230)
    weight_kg: float = Field(ge=30, le=250)
    target_weight_kg: float = Field(ge=30, le=250)
    activity_level: Literal["sedentary", "light", "moderate", "active", "very_active"]
    environment: Literal["home", "gym"]
    date: date

    @model_validator(mode="after")
    def target_above_current(self):
        if self.target_weight_kg <= self.weight_kg:
            raise ValueError("Target weight must be higher than current weight")
        return self


class CheckInIn(BaseModel):
    weight_kg: float = Field(ge=30, le=250)
    difficulty: int = Field(ge=1, le=5)
    notes: str = Field(default="", max_length=500)
    date: date
