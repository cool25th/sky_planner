import json
import os
from pathlib import Path
from typing import Any, Dict
from ..models.batch import NormalizedBatch


class BatchGenerator:
    """
    Saves and serializes NormalizedBatch objects into standard JSON artifacts.
    """

    @classmethod
    def save_batch(cls, batch: NormalizedBatch, output_path: str) -> str:
        path = Path(output_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        data = batch.model_dump(mode="json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return str(path.resolve())
