package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/luoyu15/agentdiy/server/internal/config"
	httpx "github.com/luoyu15/agentdiy/server/internal/http"
	"github.com/luoyu15/agentdiy/server/internal/http/handler"
	"github.com/luoyu15/agentdiy/server/internal/storage"
)

func main() {
	cfg := config.FromEnv()
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	repo := storage.NewMemoryAnnotationRepository()
	healthHandler := handler.NewHealthHandler()
	annotationHandler := handler.NewAnnotationHandler(repo)
	syncHandler := handler.NewSyncHandler()

	router := httpx.NewRouter(healthHandler, annotationHandler, syncHandler)
	server := httpx.NewServer(cfg.HTTPAddr, router)

	go func() {
		logger.Info("api server started", "addr", cfg.HTTPAddr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("server failed", "error", err)
			os.Exit(1)
		}
	}()

	waitForShutdown(server, logger)
}

func waitForShutdown(server *http.Server, logger *slog.Logger) {
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	<-signals

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		logger.Error("graceful shutdown failed", "error", err)
		return
	}
	logger.Info("server stopped")
}
