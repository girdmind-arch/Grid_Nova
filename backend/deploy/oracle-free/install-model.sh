#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
APP_DIR="/opt/gridnova"
LLAMA_DIR="$APP_DIR/llama.cpp"
MODEL_DIR="$APP_DIR/models"
PEFT_DIR="$APP_DIR/peft-adapter"
VENV_DIR="$APP_DIR/venv"
API_KEY_FILE="/etc/gridnova/local-model-api-keys"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo $0 [path-to-Grid_Nova]" >&2
  exit 1
fi
if [[ "$(uname -m)" != "aarch64" ]]; then
  echo "This setup expects an Oracle Ampere A1 (ARM64) Ubuntu VM." >&2
  exit 1
fi
if [[ ! -f "$REPO_DIR/backend/local-model/adapters/adapters.safetensors" ]]; then
  echo "The GridNova-trained adapter was not found under $REPO_DIR/backend/local-model." >&2
  exit 1
fi

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  build-essential cmake git curl ca-certificates python3 python3-venv python3-dev \
  libcurl4-openssl-dev libgomp1

id gridnova >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin gridnova
install -d -o gridnova -g gridnova "$APP_DIR" "$MODEL_DIR" "$APP_DIR/cache" "$APP_DIR/cache/huggingface"
install -d -m 0750 -o root -g gridnova /etc/gridnova

if [[ ! -d "$LLAMA_DIR/.git" ]]; then
  git clone --depth 1 https://github.com/ggml-org/llama.cpp.git "$LLAMA_DIR"
fi
cmake -S "$LLAMA_DIR" -B "$LLAMA_DIR/build" \
  -DCMAKE_BUILD_TYPE=Release -DGGML_NATIVE=OFF -DGGML_OPENMP=ON -DLLAMA_CURL=ON -DLLAMA_BUILD_SERVER=ON
cmake --build "$LLAMA_DIR/build" --config Release --parallel 2 --target llama-server

python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/python" -m pip install --upgrade pip
"$VENV_DIR/bin/python" -m pip install numpy safetensors torch transformers huggingface_hub sentencepiece
"$VENV_DIR/bin/python" "$REPO_DIR/backend/gridnova/ml/export_mlx_adapter.py" \
  --adapter "$REPO_DIR/backend/local-model/adapters/adapters.safetensors" \
  --config "$REPO_DIR/backend/local-model/adapters/adapter_config.json" \
  --output "$PEFT_DIR"
"$VENV_DIR/bin/python" "$LLAMA_DIR/convert_lora_to_gguf.py" \
  --base-model-id Qwen/Qwen3-1.7B \
  --outtype f16 \
  --outfile "$MODEL_DIR/gridnova-lora.gguf" \
  "$PEFT_DIR"
chown -R gridnova:gridnova "$APP_DIR"

if [[ ! -s "$API_KEY_FILE" ]]; then
  printf 'Paste the existing GRIDNOVA_LOCAL_MODEL_TOKEN (input hidden): ' >&2
  IFS= read -r -s api_key
  printf '\n' >&2
  if [[ -z "$api_key" || "$api_key" == *$'\n'* ]]; then
    echo "A non-empty single-line bearer token is required." >&2
    exit 1
  fi
  printf '%s\n' "$api_key" > "$API_KEY_FILE"
  unset api_key
  chown root:gridnova "$API_KEY_FILE"
  chmod 0640 "$API_KEY_FILE"
fi

cat > /etc/systemd/system/gridnova-local-model.service <<EOF
[Unit]
Description=GridNova self-hosted Qwen3 model
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=gridnova
Group=gridnova
Environment=HF_HOME=$APP_DIR/cache/huggingface
Environment=LLAMA_CACHE=$APP_DIR/cache/llama.cpp
Environment=HOME=$APP_DIR
Environment=LLAMA_ARG_CHAT_TEMPLATE_KWARGS={\"enable_thinking\":false}
ExecStart=$LLAMA_DIR/build/bin/llama-server --hf-repo tensorblock/Qwen_Qwen3-1.7B-GGUF:Q4_K_M --lora-scaled $MODEL_DIR/gridnova-lora.gguf:1.0 --host 127.0.0.1 --port 8001 --ctx-size 4096 --threads 2 --parallel 1 --api-key-file $API_KEY_FILE --no-webui
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$APP_DIR/cache

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now gridnova-local-model.service

if ! command -v tailscale >/dev/null 2>&1; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi
echo
echo "Model installed. Next, sign this VM into your free Tailscale account:"
echo "  sudo tailscale up --hostname=gridnova-model"
echo "Follow the one-time login URL printed by that command. Then enable Funnel:"
echo "  sudo tailscale funnel --bg 8001"
echo "Read the Funnel URL with: sudo tailscale funnel status"
echo "Set Railway GRIDNOVA_LOCAL_MODEL_URL to <Funnel-URL>/v1/chat/completions."
