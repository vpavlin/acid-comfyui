IMAGE=quay.io/vpavlin0/comfyui:prep

all: build push

build: buildapi
	podman build -t $(IMAGE) .

dev:
	podman build -t $(IMAGE) -f Dockerfile.dev .

dev-run:
	podman run -it --rm -p 8085:8080 --name comfyui -e COMMANDLINE_ARGS="--cpu --port=9090" -v $(PWD)/models:/comfyui/models -v $(PWD)/nodes:/comfyui/custom_nodes $(IMAGE)

push:
	podman push $(IMAGE)

run:
	go run main.go

buildapi:
	go build -o _build/comfyshim main.go