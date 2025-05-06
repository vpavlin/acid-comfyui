#!/bin/bash

. /comfyui/.venv/bin/activate
/comfyui/prep.sh

exec /comfyui/entrypoint.sh