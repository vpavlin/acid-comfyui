FROM docker.io/library/golang:tip-bookworm AS comfyshim

ADD main.go go.mod go.sum Makefile /app/
RUN cd /app &&\
    make buildapi

FROM quay.io/vpavlin0/comfyui

USER root

RUN curl -L -O https://github.com/caddyserver/caddy/releases/download/v2.10.0/caddy_2.10.0_linux_amd64.tar.gz &&\
    tar xzf caddy_2.10.0_linux_amd64.tar.gz &&\
    mv caddy /usr/bin/caddy &&\
    rm -f caddy_2.10.0_linux_amd64.tar.gz

ADD prep.sh custom_models.json custom_nodes.txt custom_entrypoint.sh /comfyui/
#RUN bash /comfyui/prep.sh 
ADD index.html /comfyui
COPY --from=comfyshim /app/_build/comfyshim /comfyui/comfyshim

ENTRYPOINT ["/bin/bash", "/comfyui/custom_entrypoint.sh"]