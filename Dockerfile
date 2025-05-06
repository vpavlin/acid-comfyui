FROM quay.io/vpavlin0/comfyui

USER root

ADD prep.sh custom_models.txt custom_nodes.txt custom_entrypoint.sh /comfyui/
RUN chown fcb:fcb /comfyui/prep.sh && chmod +x /comfyui/prep.sh

USER fcb

ENTRYPOINT ["/bin/bash", "/comfyui/custom_entrypoint.sh"]