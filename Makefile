ROOT_DIR := $(shell pwd)

.PHONY: extension-install extension-build server-test server-run server-migrate release-check

extension-install:
	npm --prefix $(ROOT_DIR)/extension install

extension-build:
	npm --prefix $(ROOT_DIR)/extension run build

server-test:
	cd $(ROOT_DIR)/server && go test ./...

server-run:
	cd $(ROOT_DIR)/server && go run ./cmd/api

server-migrate:
	cd $(ROOT_DIR)/server && go run ./cmd/migrate

release-check:
	$(ROOT_DIR)/scripts/release-check.sh
