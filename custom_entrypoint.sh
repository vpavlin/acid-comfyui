#!/bin/bash

. /comfyui/.venv/bin/activate
/comfyui/prep.sh

/comfyui/buildshim

exec /comfyui/entrypoint.sh