#!/bin/bash

. /comfyui/.venv/bin/activate
bash /comfyui/prep.sh

cd /comfyui && /comfyshim &

exec /comfyui/entrypoint.sh