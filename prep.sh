#!/bin/bash


for i in $(cat /comfyui/custom_nodes.txt); do
    target=$(basename $i | tr '[:upper:]' '[:lower:]')   
    
    cd /comfyui/custom_nodes 
    if ! [ -f $target ]; then
        git clone $i ${target}
    fi
    cd ${target}
    git pull
    pip install -r requirements.txt
done

for i in $(cat comfyui/custom_models.txt); do
    cd /comfyui/models
    name=$(basename $i)
    if ! [ -f $name ]; then
        echo "==> Downloading $i"
        curl -O $i
    fi
done