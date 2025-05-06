IMAGE=quay.io/vpavlin0/comfyui:prep

all: build push

build:
	podman build -t $(IMAGE) .

push:
	podman push $(IMAGE)