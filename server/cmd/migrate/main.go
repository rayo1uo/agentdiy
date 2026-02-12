package main

import (
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"

	_ "github.com/go-sql-driver/mysql"
	"github.com/luoyu15/agentdiy/server/internal/config"
)

type migrationFile struct {
	version string
	path    string
}

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	cfg := config.FromEnv()

	if strings.TrimSpace(cfg.MySQLDSN) == "" {
		logger.Error("MYSQL_DSN is required for migration")
		os.Exit(1)
	}

	db, err := sql.Open("mysql", ensureMultiStatements(cfg.MySQLDSN))
	if err != nil {
		logger.Error("failed to open mysql connection", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		logger.Error("failed to ping mysql", "error", err)
		os.Exit(1)
	}

	if err := ensureSchemaMigrationsTable(db); err != nil {
		logger.Error("failed to create schema_migrations table", "error", err)
		os.Exit(1)
	}

	applied, err := loadAppliedVersions(db)
	if err != nil {
		logger.Error("failed to load applied migrations", "error", err)
		os.Exit(1)
	}

	files, err := collectMigrationFiles("migrations")
	if err != nil {
		logger.Error("failed to collect migration files", "error", err)
		os.Exit(1)
	}

	appliedCount := 0
	for _, file := range files {
		if applied[file.version] {
			continue
		}
		if err := applyMigration(db, file); err != nil {
			logger.Error("failed to apply migration", "version", file.version, "error", err)
			os.Exit(1)
		}
		logger.Info("migration applied", "version", file.version)
		appliedCount++
	}

	logger.Info("migration completed", "applied", appliedCount, "total", len(files))
}

func ensureMultiStatements(dsn string) string {
	if strings.Contains(dsn, "multiStatements=") {
		return dsn
	}
	separator := "?"
	if strings.Contains(dsn, "?") {
		separator = "&"
	}
	return dsn + separator + "multiStatements=true"
}

func ensureSchemaMigrationsTable(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version VARCHAR(255) NOT NULL PRIMARY KEY,
			applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	return err
}

func loadAppliedVersions(db *sql.DB) (map[string]bool, error) {
	rows, err := db.Query(`SELECT version FROM schema_migrations`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string]bool)
	for rows.Next() {
		var version string
		if scanErr := rows.Scan(&version); scanErr != nil {
			return nil, scanErr
		}
		result[version] = true
	}
	return result, rows.Err()
}

func collectMigrationFiles(dir string) ([]migrationFile, error) {
	entries := make([]migrationFile, 0)
	err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			return nil
		}
		if filepath.Ext(path) != ".sql" {
			return nil
		}
		entries = append(entries, migrationFile{
			version: filepath.Base(path),
			path:    path,
		})
		return nil
	})
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, fmt.Errorf("migration directory not found: %s", dir)
		}
		return nil, err
	}

	sort.Slice(entries, func(i, j int) bool {
		return entries[i].version < entries[j].version
	})
	return entries, nil
}

func applyMigration(db *sql.DB, file migrationFile) error {
	content, err := os.ReadFile(file.path)
	if err != nil {
		return err
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	if _, err := tx.Exec(string(content)); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO schema_migrations(version) VALUES (?)`, file.version); err != nil {
		return err
	}
	return tx.Commit()
}
