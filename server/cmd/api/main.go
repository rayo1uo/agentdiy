package main

import (
	"context"
	"database/sql"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"github.com/rayo1uo/annota/server/internal/auth"
	"github.com/rayo1uo/annota/server/internal/config"
	httpx "github.com/rayo1uo/annota/server/internal/http"
	"github.com/rayo1uo/annota/server/internal/http/handler"
	"github.com/rayo1uo/annota/server/internal/storage"
)

func main() {
	cfg := config.FromEnv()
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	annotationRepo, authRepo, syncRepo := buildRepositories(cfg, logger)
	authService := auth.NewService(authRepo, cfg.JWTSecret, cfg.AccessTokenTTL, cfg.RefreshTokenTTL)
	healthHandler := handler.NewHealthHandler()
	authHandler := handler.NewAuthHandler(authService)
	annotationHandler := handler.NewAnnotationHandler(annotationRepo)
	syncHandler := handler.NewSyncHandler(annotationRepo, syncRepo)
	privacyHandler := handler.NewPrivacyHandler(annotationRepo, authRepo, syncRepo, logger)

	router := httpx.NewRouter(
		cfg.JWTSecret,
		cfg.AllowedOrigins,
		healthHandler,
		authHandler,
		annotationHandler,
		syncHandler,
		privacyHandler,
	)
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

func buildRepositories(cfg config.Config, logger *slog.Logger) (storage.AnnotationRepository, auth.Repository, storage.SyncRepository) {
	if cfg.StorageBackend != "mysql" {
		return storage.NewMemoryAnnotationRepository(), storage.NewMemoryAuthRepository(), storage.NewMemorySyncRepository()
	}

	db, err := sql.Open("mysql", cfg.MySQLDSN)
	if err != nil {
		logger.Error("failed to initialize mysql storage, fallback to memory", "error", err)
		return storage.NewMemoryAnnotationRepository(), storage.NewMemoryAuthRepository(), storage.NewMemorySyncRepository()
	}

	if err := db.Ping(); err != nil {
		logger.Error("failed to ping mysql, fallback to memory", "error", err)
		_ = db.Close()
		return storage.NewMemoryAnnotationRepository(), storage.NewMemoryAuthRepository(), storage.NewMemorySyncRepository()
	}

	logger.Info("using mysql storage backend")
	return storage.NewMySQLAnnotationRepository(db), storage.NewMySQLAuthRepository(db), storage.NewMySQLSyncRepository(db)
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
