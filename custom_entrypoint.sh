#!/bin/bash

. /comfyui/.venv/bin/activate
#bash /comfyui/prep.sh

cd /comfyui && caddy start

cd /comfyui && ./comfyshim
sleep 10000