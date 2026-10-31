# FairQueue — top level commands.
#
# Two ways to run the dependencies locally:
#   make services-up   Postgres + Redis as Homebrew services (no Docker needed)
#   make compose-up    the whole stack in Docker
#
#   make up            k3d cluster + kubernetes deploy   (added in P5)
#   make bench         k6 benchmarks + RESULTS.md        (added in P7)
#   make down          tear everything down

SHELL := /bin/bash
PG := /opt/homebrew/opt/postgresql@17/bin

.PHONY: install services-up services-down db-create migrate seed db-reset \
        dev-api dev-worker dev-web typecheck test compose-up compose-down up bench down

install:
	cd api && npm install
	cd worker && npm install
	cd web && npm install

## --- local services (no Docker) ---

services-up:
	brew services start postgresql@17
	brew services start redis

services-down:
	brew services stop postgresql@17
	brew services stop redis

db-create:
	$(PG)/psql -d postgres -c "CREATE ROLE fairqueue WITH LOGIN PASSWORD 'fairqueue' CREATEDB;" || true
	$(PG)/psql -d postgres -c "CREATE DATABASE fairqueue OWNER fairqueue;" || true

migrate:
	cd api && set -a && . ../.env && set +a && npx prisma migrate deploy

seed:
	cd api && set -a && . ../.env && set +a && npm run seed

db-reset:
	cd api && set -a && . ../.env && set +a && npx prisma migrate reset --force

## --- run the three services in separate terminals ---

dev-api:
	cd api && set -a && . ../.env && set +a && npm run dev

dev-worker:
	cd worker && set -a && . ../.env && set +a && npm run dev

dev-web:
	cd web && npm run dev

## --- Docker ---

compose-up:
	docker compose up -d --build
	docker compose exec api npx prisma migrate deploy
	docker compose exec api npm run seed

compose-down:
	docker compose down

## --- checks ---

typecheck:
	cd api && npm run typecheck
	cd worker && npm run typecheck
	cd web && npm run typecheck

test:
	cd api && npm test

## --- kubernetes & benchmarks ---

up:
	@echo "k3d cluster + deploy — added in phase P5"

bench:
	@echo "k6 benchmarks — added in phase P7"

down: compose-down services-down
