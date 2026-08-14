#!/bin/bash
# start-all.sh — launch all dev services in a tmux session, each in its own window
# panes run fish (your default shell); shared venv at /home/abeer/Downloads/git/.venv

SESSION="dev"
VENV_ACTIVATE="/home/abeer/Downloads/git/.venv/bin/activate.fish"

tmux kill-session -t "$SESSION" 2>/dev/null

# Window 1: ComfyUI (shared venv + python)
tmux new-session -d -s "$SESSION" -n comfyui \
  "cd /home/abeer/Downloads/imagegen/ComfyUI && fish -C \"source $VENV_ACTIVATE; python main.py --enable-manager\""

# Window 2: Newscast-AI npm dev server (no venv needed)
tmux new-window -t "$SESSION" -n newscast \
  "cd /home/abeer/Downloads/git/Newscast-AI && fish -C 'npm run dev'"

# Window 3: Kokoro server (shared venv + python)
tmux new-window -t "$SESSION" -n kokoro \
  "cd /home/abeer/Downloads/git/Newscast-AI && fish -C \"source $VENV_ACTIVATE; python scripts/kokoro_server.py\""

# Window 4: cloudflared tunnel
tmux new-window -t "$SESSION" -n tunnel \
  "fish -C 'cloudflared tunnel --protocol http2 run t0r'"

tmux attach -t "$SESSION"
