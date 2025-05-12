IMAGE=quay.io/vpavlin0/comfyui:prep

all: build push

build: buildapi
	podman build -t $(IMAGE) .

push:
	podman push $(IMAGE)

run:
	go run main.go

buildapi:
	go build -o _build/comfyshim main.go