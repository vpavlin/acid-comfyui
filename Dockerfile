FROM quay.io/vpavlin0/comfyui

USER root

ADD prep.sh custom_models.txt custom_nodes.txt custom_entrypoint.sh /comfyui/
RUN chmod +x /comfyui/prep.sh

ENTRYPOINT ["/bin/bash", "/comfyui/custom_entrypoint.sh"]