package main

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type PullModelRequest struct {
	HuggingFaceURL string `json:"hugging_face_url"`
	Destination    string `json:"destination"`
}

type PullNodesRequest struct {
	RepoURL string `json:"repo_url"`
}

type AppStatus struct {
	Uptime        string    `json:"uptime"`
	LastModelPull time.Time `json:"last_model_pull"`
	LastNodesPull time.Time `json:"last_nodes_pull"`
	mu            sync.Mutex
	Messages      []string `json:"messages"`
	State         string   `json:"state"`
}

func (as *AppStatus) AddMessage(message string) {
	as.mu.Lock()
	defer as.mu.Unlock()
	as.Messages = append(as.Messages, message)
}

var appStatus = &AppStatus{State: "uninitialized"}
var startTime = time.Now()

func init() {
	appStatus.LastModelPull = time.Time{}
	appStatus.LastNodesPull = time.Time{}
}

func pullModel(c *gin.Context) {
	var req PullModelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	repoName := req.HuggingFaceURL[len("https://huggingface.co/"):]
	if idx := strings.Index(repoName, "/"); idx != -1 {
		repoName = repoName[idx+1:]
	}

	if err := os.MkdirAll(fmt.Sprintf("%s/%s", "models", req.Destination), os.ModePerm); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to create models subdirectory: %v", err)})
		return
	}

	tmpDest := fmt.Sprintf("/tmp/%s", repoName)
	cmd := exec.Command("git", "clone", req.HuggingFaceURL, tmpDest)
	if err := cmd.Run(); err != nil {
		fmt.Println(err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to pull model: %v", err)})
		return
	}

	//copy the file tmpDest/repoName.safetensors to models/req.Destination/
	src := fmt.Sprintf("%s/%s.safetensors", tmpDest, repoName)
	dst := fmt.Sprintf("models/%s/%s.safetensors", req.Destination, repoName)
	if err := copy(src, dst, 1024*1024*10); err != nil {
		fmt.Println(err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to copy file: %v", err)})
		return
	}

	appStatus.mu.Lock()
	appStatus.LastModelPull = time.Now()
	appStatus.mu.Unlock()

	c.JSON(http.StatusOK, gin.H{"message": "Model pulled successfully"})
}

func pullNodes(c *gin.Context) {
	var req PullNodesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := cloneCustomNode(req.RepoURL); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	appStatus.mu.Lock()
	appStatus.LastNodesPull = time.Now()
	appStatus.mu.Unlock()

	c.JSON(http.StatusOK, gin.H{"message": "Nodes pulled successfully"})
}

func serveIndex(c *gin.Context) {
	c.File("index.html")
}

func proxyToComfyUI(c *gin.Context) {
	targetURL, err := url.Parse("http://localhost:9090")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Invalid target URL"})
		return
	}

	// Remove the /comfyui prefix from the request path
	requestURI := c.Request.RequestURI
	if strings.HasPrefix(requestURI, "/comfyui") {
		requestURI = strings.Replace(requestURI, "/comfyui", "", 1)
	}

	// Create a new request with the modified path
	newRequest := c.Request.Clone(c.Request.Context())
	newRequest.RequestURI = requestURI
	newRequest.URL.Scheme = targetURL.Scheme
	newRequest.URL.Host = targetURL.Host
	newRequest.URL.RawQuery = c.Request.URL.RawQuery

	proxy := httputil.NewSingleHostReverseProxy(targetURL)
	proxy.ServeHTTP(c.Writer, newRequest)
}

func getAppStatus(c *gin.Context) {
	uptime := time.Since(startTime)

	appStatus.mu.Lock()
	status := AppStatus{
		Uptime:        uptime.String(),
		LastModelPull: appStatus.LastModelPull,
		LastNodesPull: appStatus.LastNodesPull,
		Messages:      appStatus.Messages,
		State:         appStatus.State,
	}
	appStatus.mu.Unlock()

	c.JSON(http.StatusOK, status)
}

func runInitialization() {
	appStatus.mu.Lock()
	appStatus.State = "initializing"
	appStatus.mu.Unlock()
	startTime = time.Now()

	//read custom_nodes.txt
	customNodes, err := os.ReadFile("custom_nodes.txt")
	if err != nil {
		log.Fatalf("Error reading custom_nodes.txt: %v", err)
	}
	if len(customNodes) == 0 {
		log.Println("No custom nodes found in custom_nodes.txt")
		return
	}

	wg := sync.WaitGroup{}

	// parse custom_nodes.txt
	lines := strings.Split(string(customNodes), "\n")
	for _, line := range lines {
		if strings.TrimSpace(line) == "" || strings.HasPrefix(line, "#") {
			continue
		}

		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := cloneCustomNode(line); err != nil {
				log.Printf("Error cloning custom node: %v", err)
			}
		}()
	}

	wg.Wait()

	appStatus.mu.Lock()
	appStatus.State = "initialized"
	appStatus.mu.Unlock()
	appStatus.AddMessage("Initialization Finished!")

}

func main() {
	r := gin.Default()

	r.GET("/", serveIndex)
	r.POST("/api/v1/pull_model", pullModel)
	r.POST("/api/v1/pull_nodes", pullNodes)
	r.GET("/api/v1/status", getAppStatus)
	r.Any("/comfyui/*action", proxyToComfyUI)

	go runInitialization()

	log.Println("Starting server on :8080")
	if err := r.Run(":8080"); err != nil {
		log.Fatalf("Could not start server: %v", err)
	}
}

var BUFFERSIZE int64

func copy(src, dst string, BUFFERSIZE int64) error {
	sourceFileStat, err := os.Stat(src)
	if err != nil {
		return err
	}

	if !sourceFileStat.Mode().IsRegular() {
		return fmt.Errorf("%s is not a regular file.", src)
	}

	source, err := os.Open(src)
	if err != nil {
		return err
	}
	defer source.Close()

	_, err = os.Stat(dst)
	if err == nil {
		return fmt.Errorf("File %s already exists.", dst)
	}

	destination, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer destination.Close()

	if err != nil {
		panic(err)
	}

	buf := make([]byte, BUFFERSIZE)
	for {
		n, err := source.Read(buf)
		if err != nil && err != io.EOF {
			return err
		}
		if n == 0 {
			break
		}

		if _, err := destination.Write(buf[:n]); err != nil {
			return err
		}
	}
	return err
}

func cloneCustomNode(repoUrl string) error {
	appStatus.AddMessage(fmt.Sprintf("Pulling nodes from %s", repoUrl))
	customNodesDir := "custom_nodes"
	if err := os.MkdirAll(customNodesDir, os.ModePerm); err != nil {
		return fmt.Errorf("Failed to create custom_nodes directory: %v", err)
	}

	repoName := repoUrl[len("https://github.com/"):]
	if idx := strings.Index(repoName, "/"); idx != -1 {
		repoName = repoName[idx+1:]
	}

	cmd := exec.Command("git", "clone", repoUrl, fmt.Sprintf("%s/%s", customNodesDir, repoName))
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("Failed to pull nodes: %v", err)
	}

	appStatus.AddMessage(fmt.Sprintf("Running install of nodes from %s", repoName))

	cmdPip := exec.Command("pip", "install", "-r", fmt.Sprintf("%s/%s/requirements.txt", customNodesDir, repoName))
	log.Println(cmdPip.Args)
	if err := cmdPip.Run(); err != nil {
		log.Println(err)
		cmdInstall := exec.Command("python3", "install.py")
		cmdInstall.Dir = fmt.Sprintf("%s/%s", customNodesDir, repoName)
		if err := cmdInstall.Run(); err != nil {
			return fmt.Errorf("Failed to install requirements: %v", err)
		}
	}

	appStatus.AddMessage(fmt.Sprintf("Nodes %s pulled successfully", repoName))
	return nil
}
