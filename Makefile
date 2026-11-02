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
        dev-api dev-worker dev-web sync-events typecheck test compose-up compose-down \
        cluster images import-images deploy redeploy-seed up status wait-metrics \
        watch-hpa logs-api logs-worker mode-naive mode-fairqueue \
        bench-limits prod-limits scale-test bench bench-one bench-clean \
        cluster-down down

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

## --- live events ---

# Fetch real events now. Does nothing without credentials, which is the point:
# FairQueue has to run on its seeded catalogue alone.
sync-events:
	cd api && set -a && . ../.env && set +a && npm run sync-events

## --- checks ---

typecheck:
	cd api && npm run typecheck
	cd worker && npm run typecheck
	cd web && npm run typecheck

test:
	cd api && npm test

## --- kubernetes ---
#
# One cluster, three locally built images, plain manifests. No Helm: every
# object in k8s/ is a file you can read top to bottom.

CLUSTER := fairqueue
NS      := fairqueue
# Host port 8080 is mapped to the web Service's NodePort 30080 on the server
# node. A NodePort answers on every node, so it does not matter which node the
# web pod lands on.
WEB_PORT := 8080

cluster:
	@k3d cluster list $(CLUSTER) >/dev/null 2>&1 \
		&& echo "cluster $(CLUSTER) already exists" \
		|| k3d cluster create $(CLUSTER) \
			--agents 2 \
			-p "$(WEB_PORT):30080@server:0" \
			--wait

images:
	docker build -t fairqueue/api:dev ./api
	docker build -t fairqueue/worker:dev -f worker/Dockerfile .
	docker build -t fairqueue/web:dev ./web

# k3d nodes have their own image store, so locally built images have to be
# copied in. Without this the pods sit in ImagePullBackOff looking for an
# image that only exists on the host.
import-images:
	k3d image import fairqueue/api:dev fairqueue/worker:dev fairqueue/web:dev -c $(CLUSTER)

deploy:
	kubectl apply -f k8s/
	@echo "waiting for the datastores"
	kubectl -n $(NS) rollout status deploy/postgres --timeout=180s
	kubectl -n $(NS) rollout status deploy/redis --timeout=120s
	@echo "running migrations and seed"
	kubectl -n $(NS) wait --for=condition=complete job/migrate-seed --timeout=300s
	kubectl -n $(NS) rollout status deploy/api --timeout=180s
	kubectl -n $(NS) rollout status deploy/worker --timeout=120s
	kubectl -n $(NS) rollout status deploy/web --timeout=120s

# A redeploy has to replace the Job, because a completed Job is immutable.
redeploy-seed:
	kubectl -n $(NS) delete job migrate-seed --ignore-not-found
	kubectl apply -f k8s/40-migrate-job.yaml
	kubectl -n $(NS) wait --for=condition=complete job/migrate-seed --timeout=300s

up: cluster images import-images deploy status
	@echo
	@echo "FairQueue is up at http://localhost:$(WEB_PORT)"

status:
	@echo
	kubectl -n $(NS) get pods -o wide
	@echo
	kubectl -n $(NS) get hpa

# The autoscaler needs metrics-server. k3s ships with it, but it takes a moment
# after the cluster starts before it reports anything.
wait-metrics:
	@echo "waiting for metrics-server"
	@until kubectl top pods -n $(NS) >/dev/null 2>&1; do sleep 5; done
	@echo "metrics are flowing"

# Live view of the autoscaler making its decision.
watch-hpa:
	watch -n 2 'kubectl -n $(NS) get hpa api; echo; kubectl -n $(NS) get pods -l app=api; echo; kubectl top pods -n $(NS) -l app=api 2>/dev/null'

logs-api:
	kubectl -n $(NS) logs -l app=api --tail=100 -f

logs-worker:
	kubectl -n $(NS) logs -l app=worker --tail=100 -f

# Switch the cluster between the broken "before" build and the real one.
mode-naive:
	kubectl -n $(NS) set env deploy/api MODE=naive
	kubectl -n $(NS) rollout status deploy/api --timeout=120s

mode-fairqueue:
	kubectl -n $(NS) set env deploy/api MODE=fairqueue
	kubectl -n $(NS) rollout status deploy/api --timeout=120s

## --- benchmarks ---

# Every virtual user in a load test shares the generator's single address,
# which is the same shape as an office behind one NAT. So the per-address limit
# is raised for benchmark runs. The per-account limit — the one that actually
# costs a bot something — is left exactly as it runs in production.
bench-limits:
	kubectl -n $(NS) set env deploy/api RATE_LIMIT_IP_FACTOR=100000
	kubectl -n $(NS) rollout status deploy/api --timeout=120s

prod-limits:
	kubectl -n $(NS) set env deploy/api RATE_LIMIT_IP_FACTOR=20
	kubectl -n $(NS) rollout status deploy/api --timeout=120s

# Proves the api scales out under load and comes back down afterwards.
scale-test: wait-metrics bench-limits
	bash bench/scale-test.sh

# One scenario, one mode. The orchestrator owns the api process, because the
# mode is read at boot and starting it here is the only way to be sure the
# result file describes the server that produced it.
bench-one:
	@test -n "$(SCENARIO)" || (echo "usage: make bench-one SCENARIO=hot-seats MODE=naive"; exit 1)
	set -a && . ./.env && set +a && npx --prefix api tsx bench/run.ts $(SCENARIO) $(MODE)

# Every scenario against both builds, then the comparison table.
bench:
	set -a && . ./.env && set +a && bash bench/run-all.sh

# Put the database back if a run was interrupted mid-naive and left duplicates.
bench-clean:
	set -a && . ./.env && set +a && npx --prefix api tsx bench/clean.ts

## --- teardown ---

cluster-down:
	-k3d cluster delete $(CLUSTER)

down: compose-down services-down cluster-down
