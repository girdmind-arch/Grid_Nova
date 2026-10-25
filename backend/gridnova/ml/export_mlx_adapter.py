"""Convert GridNova's MLX LoRA adapter to the Hugging Face PEFT layout.

MLX and PEFT store LoRA matrices in opposite orientations. Some MLX releases
write the native layout (A: input x rank, B: rank x output); the checked-in
adapter may already have PEFT orientation. Detect either form from the rank and
transpose only when needed, then write a PEFT adapter for llama.cpp conversion.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from safetensors.numpy import load_file, save_file


def _convert(source: Path, config_path: Path, destination: Path) -> None:
    config = json.loads(config_path.read_text(encoding="utf-8"))
    lora = config.get("lora_parameters", {})
    rank = int(lora.get("rank", 0))
    scale = float(lora.get("scale", 0))
    if rank < 1 or scale <= 0:
        raise ValueError("adapter_config.json must include a positive LoRA rank and scale")

    source_weights = load_file(str(source))
    converted: dict[str, object] = {}
    targets: set[str] = set()
    layers: set[int] = set()
    pairs: dict[str, set[str]] = {}

    for old_name, tensor in source_weights.items():
        if old_name.endswith(".lora_a"):
            leaf = "lora_A.weight"
            side = "A"
        elif old_name.endswith(".lora_b"):
            leaf = "lora_B.weight"
            side = "B"
        else:
            raise ValueError(f"Unsupported MLX adapter tensor: {old_name}")

        prefix = old_name.rsplit(".", 1)[0]
        shape = tuple(tensor.shape)
        if len(shape) != 2:
            raise ValueError(f"Expected 2D LoRA tensor at {old_name}, got {shape}")

        # MLX native: A=(input, rank), B=(rank, output).
        # PEFT:       A=(rank, input), B=(output, rank).
        if side == "A" and shape[1] == rank:
            tensor = tensor.T.copy()
        elif side == "B" and shape[0] == rank:
            tensor = tensor.T.copy()
        elif side == "A" and shape[0] != rank:
            raise ValueError(f"LoRA A rank mismatch at {old_name}: {shape}")
        elif side == "B" and shape[1] != rank:
            raise ValueError(f"LoRA B rank mismatch at {old_name}: {shape}")

        new_name = f"base_model.model.{prefix}.{leaf}"
        converted[new_name] = tensor
        pairs.setdefault(prefix, set()).add(side)
        module = prefix.split(".")[-1]
        targets.add(module)
        parts = prefix.split(".")
        if len(parts) > 2 and parts[1] == "layers" and parts[2].isdigit():
            layers.add(int(parts[2]))

    incomplete = [name for name, sides in pairs.items() if sides != {"A", "B"}]
    if incomplete:
        raise ValueError("Incomplete LoRA A/B pairs: " + ", ".join(incomplete[:5]))

    destination.mkdir(parents=True, exist_ok=True)
    save_file(converted, str(destination / "adapter_model.safetensors"))
    peft_config = {
        "base_model_name_or_path": "Qwen/Qwen3-1.7B",
        "bias": "none",
        "inference_mode": True,
        "lora_alpha": rank * scale,
        "lora_dropout": float(lora.get("dropout", 0.0)),
        "peft_type": "LORA",
        "r": rank,
        "target_modules": sorted(targets),
        "task_type": "CAUSAL_LM",
        "fan_in_fan_out": False,
        "layers_to_transform": sorted(layers),
        "layers_pattern": "layers",
    }
    (destination / "adapter_config.json").write_text(
        json.dumps(peft_config, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Converted {len(converted)} tensors across {len(layers)} layers to {destination}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--adapter", type=Path, required=True, help="MLX adapters.safetensors")
    parser.add_argument("--config", type=Path, required=True, help="MLX adapter_config.json")
    parser.add_argument("--output", type=Path, required=True, help="Destination PEFT adapter folder")
    args = parser.parse_args()
    _convert(args.adapter, args.config, args.output)


if __name__ == "__main__":
    main()
