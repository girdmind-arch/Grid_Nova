"""Fine-tune the local GridNova assistant with LoRA on Apple Silicon.

The openly licensed base model is downloaded once from Hugging Face. Training
and all later inference run on the local Mac; chat requests are never sent to
that model repository or an AI API.
"""

from __future__ import annotations

import json
import os
import random
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parents[1]
EXAMPLES = HERE / "chatbot_data" / "examples.jsonl"
DATA_DIR = BACKEND / "local-model" / "data"
ADAPTER_DIR = BACKEND / "local-model" / "adapters"
MODEL_ID = os.environ.get("GRIDNOVA_MODEL_ID", "mlx-community/Qwen3-1.7B-4bit")


def prepare_data() -> int:
    rows = [json.loads(line) for line in EXAMPLES.read_text(encoding="utf-8").splitlines() if line.strip()]
    if len(rows) < 20:
        raise SystemExit("Add at least 20 examples to chatbot_data/examples.jsonl before fine-tuning.")
    random.Random(20261025).shuffle(rows)
    train_end = int(len(rows) * 0.8)
    valid_end = int(len(rows) * 0.9)
    splits = {"train": rows[:train_end], "valid": rows[train_end:valid_end], "test": rows[valid_end:]}
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    for name, examples in splits.items():
        path = DATA_DIR / f"{name}.jsonl"
        path.write_text("".join(json.dumps(item, ensure_ascii=False) + "\n" for item in examples), encoding="utf-8")
    return len(rows)


def main() -> None:
    count = prepare_data()
    command = [
        sys.executable, "-m", "mlx_lm", "lora",
        "--model", MODEL_ID,
        "--train",
        "--data", str(DATA_DIR),
        "--adapter-path", str(ADAPTER_DIR),
        "--fine-tune-type", "lora",
        "--num-layers", os.environ.get("GRIDNOVA_TRAIN_LAYERS", "8"),
        "--batch-size", os.environ.get("GRIDNOVA_TRAIN_BATCH", "1"),
        "--iters", os.environ.get("GRIDNOVA_TRAIN_ITERS", "300"),
        "--max-seq-length", os.environ.get("GRIDNOVA_TRAIN_SEQ_LENGTH", "1024"),
        "--learning-rate", os.environ.get("GRIDNOVA_TRAIN_LR", "1e-5"),
        "--mask-prompt",
    ]
    print(f"Fine-tuning {MODEL_ID} with {count} GridNova examples on this Apple Silicon Mac.")
    print("The source model is downloaded once; chat inference remains local after that.")
    ADAPTER_DIR.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(command, cwd=BACKEND, check=True)


if __name__ == "__main__":
    main()
