"""Local Apple-Silicon inference server for GridNova's fine-tuned model.

Run from ``backend/`` with the optional MLX dependencies installed. This server
loads the base weights and GridNova LoRA adapter into the Mac's unified memory.
"""

from __future__ import annotations

import os
import hmac
import logging
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, Header, HTTPException, Request
from pydantic import BaseModel, Field

log = logging.getLogger("gridnova.local_model")

MODEL_ID = os.environ.get("GRIDNOVA_MODEL_ID", "mlx-community/Qwen3-1.7B-4bit")
ADAPTER_PATH = Path(os.environ.get("GRIDNOVA_ADAPTER_PATH", "local-model/adapters"))
HOST = os.environ.get("GRIDNOVA_MODEL_HOST", "127.0.0.1")
TOKEN = os.environ.get("GRIDNOVA_LOCAL_MODEL_TOKEN", "").strip()
model = None
tokenizer = None


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(min_length=1, max_length=8000)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=14)
    max_tokens: int = Field(default=700, ge=1, le=1000)
    temperature: float = Field(default=0.3, ge=0.0, le=1.5)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global model, tokenizer
    if HOST not in {"127.0.0.1", "localhost", "::1"} and not TOKEN:
        raise RuntimeError("Set GRIDNOVA_LOCAL_MODEL_TOKEN before binding the local model server to a network interface.")
    from mlx_lm import load

    adapter = str(ADAPTER_PATH) if (ADAPTER_PATH / "adapters.safetensors").exists() else None
    if adapter is None:
        raise RuntimeError(f"Trained adapter not found at {ADAPTER_PATH}. Run python -m gridnova.ml.train_chatbot first.")
    model, tokenizer = load(MODEL_ID, adapter_path=adapter)
    yield
    model = tokenizer = None


app = FastAPI(title="GridNova Local Model", version="1.0.0", lifespan=lifespan)


def _authorized(authorization: str | None, request: Request) -> bool:
    if TOKEN:
        return bool(authorization and authorization.startswith("Bearer ") and hmac.compare_digest(authorization[7:].strip(), TOKEN))
    client = request.client.host if request.client else ""
    return client in {"127.0.0.1", "::1", "localhost"}


@app.get("/health")
def health():
    return {"status": "ready" if model is not None else "loading", "model": MODEL_ID, "fineTuned": (ADAPTER_PATH / "adapters.safetensors").exists()}


@app.post("/v1/chat/completions")
async def chat(body: ChatRequest, request: Request, authorization: str | None = Header(None)):
    if not _authorized(authorization, request):
        raise HTTPException(401, "A valid local model token is required.")
    if model is None or tokenizer is None:
        raise HTTPException(503, "The local model is still loading.")
    messages = [item.model_dump() for item in body.messages]
    try:
        prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True, enable_thinking=False)
    except TypeError:
        prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    from mlx_lm import generate
    from mlx_lm.sample_utils import make_sampler

    try:
        text = generate(model, tokenizer, prompt=prompt, max_tokens=body.max_tokens, sampler=make_sampler(body.temperature), verbose=False)
    except Exception as exc:
        log.exception("local model generation failed")
        raise HTTPException(500, "Local model generation failed.") from exc
    return {
        "id": f"chatcmpl-{uuid.uuid4().hex[:20]}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": "gridnova-local",
        "choices": [{
            "index": 0,
            "message": {"role": "assistant", "content": text.strip()},
            "finish_reason": "stop",
        }],
    }
