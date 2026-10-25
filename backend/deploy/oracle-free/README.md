# Free Oracle-hosted GridNova chatbot

This runs GridNova's existing Qwen3 1.7B LoRA adapter on Oracle Cloud Infrastructure's Always Free Ampere VM (ARM CPU) and publishes it through Tailscale Funnel's HTTPS endpoint. Inference stays on this VM; neither the chatbot nor the campus backend calls an external AI inference API. The model server listens only on loopback and requires the same bearer token already stored in Railway.

## What this free setup can and cannot promise

- Use only the Oracle Ampere A1 Always Free allowance: at most 2 OCPUs and 12 GB RAM, in the tenancy's home region. Do not select paid resources or upgrade the account. Oracle may show no available capacity in some regions.
- Oracle may reclaim a free VM if CPU, network, and (for A1) memory all remain below 20% at the 95th percentile over seven days. This is a hobby/free-tier option, not an uptime guarantee.
- Tailscale Funnel is available on all plans, gives a stable HTTPS `*.ts.net` address, and has bandwidth limits. Use a free Personal tailnet for personal/non-commercial use.
- The VM has no GPU. First startup downloads about 1.3 GB of Q4_K_M base weights; CPU answers can take noticeably longer than the Mac's MLX server.
- The OCI account flow usually asks for a phone and card for verification. Oracle says it does not charge the card unless the account is upgraded. Keep the account on the Free Tier and use only resources marked Always Free.

## Create the free VM

1. Create or sign in to an Oracle Cloud account and note its **home region**. Keep the account on its Free Tier; do not upgrade it.
2. In that home region, create an Ubuntu 24.04 ARM (Ampere A1) instance. Choose **2 OCPUs**, **12 GB memory**, and the default **50 GB boot volume**. Confirm the shape is marked Always Free before creating it.
3. Allow SSH (TCP 22) in the VM's network security list. Do not open port 8001 or expose the model server directly.
4. From your Mac, SSH to the instance, clone the public repository, and install the model:

   ```bash
   git clone https://github.com/girdmind-arch/Grid_Nova.git
   cd Grid_Nova
   sudo bash backend/deploy/oracle-free/install-model.sh "$PWD"
   ```

   The installer builds llama.cpp for ARM64, converts the checked-in MLX adapter to PEFT and GGUF, downloads the small Q4 model on first launch, and registers a systemd service. To reuse the token already configured in Railway, copy it from the local file on your Mac before SSHing:

   ```bash
   sed -n 's/^GRIDNOVA_LOCAL_MODEL_TOKEN=//p' "$HOME/Documents/ChatGPT/New project/.env.local-model" | pbcopy
   ```

   When the installer asks for the token, paste it into the SSH terminal. The prompt hides input and stores it in a root-owned file readable only by the model service. Do not put it in the repo or shell command history.

5. Sign the VM into Tailscale and turn on Funnel:

   ```bash
   sudo tailscale up --hostname=gridnova-model
   sudo tailscale funnel --bg 8001
   sudo tailscale funnel status
   ```

   Open the one-time Tailscale login URL printed by `tailscale up`. Tailscale may ask the tailnet owner to enable Funnel in the admin console the first time. Use the free Personal plan for personal/non-commercial use. The public URL should be a stable `https://…ts.net` address.

6. In Railway → GridNova → **Variables**, set `GRIDNOVA_LOCAL_MODEL_URL` to:

   ```text
   https://YOUR-VM-NAME.YOUR-TAILNET.ts.net/v1/chat/completions
   ```

   Leave `GRIDNOVA_LOCAL_MODEL_TOKEN` unchanged. Railway will redeploy; then open `/app/agents` and send a question. The status endpoint can be checked at `https://YOUR-VM-NAME.YOUR-TAILNET.ts.net/health` (it reveals readiness only; inference remains token-protected).

## Operations

```bash
sudo systemctl status gridnova-local-model
sudo journalctl -u gridnova-local-model -n 100 --no-pager
sudo tailscale funnel status
```

The model service and Funnel resume on reboot. The first model download needs a working outbound internet connection and can take a few minutes. A reboot or Oracle reclamation may stop service; check the Always Free capacity and Funnel URL if it becomes unreachable.
