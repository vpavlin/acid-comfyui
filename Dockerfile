FROM golang:tip-bookworm AS comfyshim

ADD main.go go.mod go.sum Makefile /app/
RUN cd /app &&\
    make buildapi

FROM quay.io/vpavlin0/comfyui

USER root

ADD prep.sh custom_models.txt custom_nodes.txt custom_entrypoint.sh /comfyui/
RUN bash /comfyui/prep.sh 
ADD index.html /comfyui
COPY --from=comfyshim /app/comfyshim /comfyui/comfyshim

ENTRYPOINT ["/bin/bash", "/comfyui/custom_entrypoint.sh"]