#!/bin/bash

. /comfyui/.venv/bin/activate
#bash /comfyui/prep.sh

cd /comfyui && ./comfyshim &
cd /comfyui && caddy start

/comfyui/entrypoint.sh
sleep 10000