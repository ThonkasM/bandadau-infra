# =============================================================================
# bandadau-infra — Makefile (compatible con GNU make 3.81 de macOS)
#   cp .env.example .env && make setup && make up && make seed && make smoke
# `make` o `make help` lista los objetivos.
# =============================================================================
SHELL := /bin/bash
.DEFAULT_GOAL := help

# PROJECT=otro-nombre usa otro nombre de proyecto Compose (útil para pruebas en paralelo)
COMPOSE := docker compose$(if $(PROJECT), -p $(PROJECT),)
INFRA   := --profile infra
STACK   := --profile infra --profile services
ENV_PROJECT := $(shell sed -n 's/^COMPOSE_PROJECT_NAME=//p' .env 2>/dev/null | tail -1)
PROJECT_NAME := $(if $(PROJECT),$(PROJECT),$(if $(ENV_PROJECT),$(ENV_PROJECT),bandada))
SHARED_DIR := ../bandadau-shared

.PHONY: help setup env keys rabbit-defs up up-infra up-obs down restart logs ps build seed smoke \
        reset urls validate check-infra host unhost shell-% clone-all

help: ## Lista los objetivos
	@grep -E '^[a-zA-Z_%-]+:.*## ' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

# ---------------------------------------------------------------------------
# Preparación
# ---------------------------------------------------------------------------
env: ## Crea .env desde .env.example si falta
	@test -f .env || { cp .env.example .env && echo "Creado .env (valores de desarrollo)"; }

keys: ## Genera llaves de desarrollo en secrets/ (JWT RS256 de identity, ES256 del QR de ticketing)
	@scripts/gen-keys.sh

rabbit-defs: env ## Regenera rabbitmq/definitions.json desde la plantilla y .env
	@rabbitmq/render-definitions.sh .env

setup: env ## Verifica herramientas, prepara bandadau-shared, .env, llaves y definiciones de RabbitMQ
	@echo "== Verificando herramientas =="
	@command -v docker >/dev/null || { echo "ERROR: falta docker (Docker Desktop u OrbStack)"; exit 1; }
	@docker compose version >/dev/null 2>&1 || { echo "ERROR: falta el plugin 'docker compose' (v2)"; exit 1; }
	@docker info >/dev/null 2>&1 || { echo "ERROR: el daemon de Docker no responde; abre Docker Desktop"; exit 1; }
	@command -v node >/dev/null || { echo "ERROR: falta Node (>= 22, recomendado 24)"; exit 1; }
	@node -e 'process.exit(+process.versions.node.split(".")[0] >= 22 ? 0 : 1)' || { echo "ERROR: Node $$(node -v) es muy antiguo (se requiere >= 22)"; exit 1; }
	@command -v openssl >/dev/null || { echo "ERROR: falta openssl (para make keys)"; exit 1; }
	@echo "docker $$(docker --version | cut -d' ' -f3 | tr -d ,) · node $$(node -v) · make $(MAKE_VERSION)"
	@echo "== corepack / pnpm =="
	@corepack enable 2>/dev/null || echo "AVISO: 'corepack enable' falló (¿permisos?). Ejecútalo con sudo o instala pnpm."
	@if [ "$(SKIP_SHARED)" = "1" ]; then echo "SKIP_SHARED=1: se omite bandadau-shared"; \
	 elif [ -f $(SHARED_DIR)/package.json ]; then \
	   echo "== bandadau-shared: pnpm install && pnpm build =="; \
	   cd $(SHARED_DIR) && pnpm install --frozen-lockfile && pnpm build; \
	 else echo "AVISO: no existe $(SHARED_DIR) (clona los 8 repos hermanos con scripts/clone-all.sh)"; fi
	@$(MAKE) --no-print-directory keys rabbit-defs
	@echo "== Memoria de Docker =="
	@mem=$$(docker info --format '{{.MemTotal}}' 2>/dev/null || echo 0); gb=$$((mem / 1073741824)); \
	 if [ $$gb -lt 11 ]; then echo "AVISO: Docker tiene ~$${gb} GB; la fase 1 completa recomienda >= 12 GB"; \
	   echo "       (Docker Desktop > Settings > Resources > Memory). Con menos, usa 'make up-infra' y corre servicios en el IDE."; \
	 else echo "Docker tiene ~$${gb} GB: OK"; fi
	@echo "== *.localhost =="
	@echo "api.bandada.localhost resuelve a 127.0.0.1 en macOS/Chrome/Firefox. En Safari o Linux, si no abre, agrega a /etc/hosts:"
	@echo "  127.0.0.1 bandada.localhost api.bandada.localhost app.bandada.localhost admin.bandada.localhost mfe.bandada.localhost n8n.bandada.localhost mail.bandada.localhost rabbit.bandada.localhost s3.bandada.localhost"
	@echo "Listo. Siguiente: make up && make seed && make smoke"

# ---------------------------------------------------------------------------
# Ciclo de vida
# ---------------------------------------------------------------------------
up: env keys rabbit-defs ## Infraestructura + servicios (construye imágenes desde los repos hermanos)
	$(COMPOSE) $(STACK) up -d --build
	@PROJECT=$(PROJECT_NAME) scripts/wait-healthy.sh 900
	@$(MAKE) --no-print-directory urls

up-infra: env rabbit-defs ## Solo infraestructura (postgres, mongo, dynamodb, rabbitmq, minio, mailpit, n8n, traefik)
	$(COMPOSE) $(INFRA) up -d
	@PROJECT=$(PROJECT_NAME) scripts/wait-healthy.sh 300
	@$(MAKE) --no-print-directory urls

up-obs: env keys rabbit-defs ## Como `up` + Grafana LGTM con OTLP activado en los servicios
	OTEL_SDK_DISABLED=false $(COMPOSE) $(STACK) --profile observability up -d --build
	@PROJECT=$(PROJECT_NAME) scripts/wait-healthy.sh 900
	@echo "Grafana: http://localhost:$$(sed -n 's/^GRAFANA_PORT=//p' .env | tail -1 | grep . || echo 3300)  (admin / admin)"

down: ## Detiene todo (conserva volúmenes)
	$(COMPOSE) --profile '*' down --remove-orphans

reset: ## Detiene todo y BORRA los volúmenes (bases, buckets, colas)
	$(COMPOSE) --profile '*' down -v --remove-orphans

restart: ## Reinicia servicios: make restart S=identity-service (sin S: todos)
	$(COMPOSE) $(STACK) restart $(S)

logs: ## Sigue los logs: make logs S=identity-service (sin S: todos)
	$(COMPOSE) --profile '*' logs -f --tail=100 $(S)

ps: ## Estado y healthchecks
	$(COMPOSE) --profile '*' ps -a

build: env ## Construye las imágenes de los servicios (make build S=wallet-service para uno)
	$(COMPOSE) $(STACK) build $(S)

shell-%: ## Shell dentro de un contenedor: make shell-postgres
	$(COMPOSE) --profile '*' exec $* sh -c 'command -v bash >/dev/null && exec bash || exec sh'

host: ## Redirige un servicio a tu IDE: make host S=identity-service  (deshacer: make unhost S=...)
	@test -n "$(S)" || { echo "uso: make host S=identity-service"; exit 1; }
	@PROJECT=$(PROJECT_NAME) scripts/host-upstream.sh on $(S)

unhost: ## Vuelve a correr el servicio en Docker: make unhost S=identity-service
	@test -n "$(S)" || { echo "uso: make unhost S=identity-service"; exit 1; }
	@PROJECT=$(PROJECT_NAME) scripts/host-upstream.sh off $(S)

# ---------------------------------------------------------------------------
# Datos de demo y pruebas
# ---------------------------------------------------------------------------
seed: ## Carga datos de demo (universidades, usuarios, eventos, créditos); idempotente
	node seed/seed.mjs

smoke: ## Recorre registro → login → post → recarga idempotente → inscripción → compensación → GraphQL
	COMPOSE_PROJECT=$(PROJECT_NAME) node smoke/smoke.mjs

check-infra: ## Verifica el perfil infra levantado (salud, colas, bases, tablas, buckets, rutas)
	PROJECT=$(PROJECT_NAME) scripts/check-infra.sh

validate: env ## docker compose config + sintaxis de scripts + render de definitions
	$(COMPOSE) --profile '*' config --quiet
	@bash -n scripts/*.sh postgres/init/*.sh mongo/init/init.sh minio/init.sh dynamodb/create-tables.sh rabbitmq/render-definitions.sh
	@for f in seed/*.mjs seed/lib/*.mjs smoke/*.mjs; do node --check $$f || exit 1; done
	@rabbitmq/render-definitions.sh .env.example >/dev/null && git diff --quiet rabbitmq/definitions.json || echo "AVISO: rabbitmq/definitions.json difiere de la plantilla con .env.example"
	@echo "validate OK"

urls: ## Muestra URLs, puertos y credenciales de demo
	@d=$$(sed -n 's/^BASE_DOMAIN=//p' .env 2>/dev/null | tail -1); d=$${d:-bandada.localhost}; \
	 echo ""; \
	 echo "  API REST       http://api.$$d/api/v1        (GraphQL: /graphql · JWKS: /.well-known/jwks.json)"; \
	 echo "  Landing        http://$$d                   (dev server :3000)"; \
	 echo "  App web        http://app.$$d               (dev server :8081)"; \
	 echo "  Panel          http://admin.$$d             (dev server :3001)"; \
	 echo "  n8n            http://n8n.$$d  |  http://localhost:5678"; \
	 echo "  Mailpit        http://mail.$$d |  http://localhost:8025"; \
	 echo "  RabbitMQ UI    http://rabbit.$$d |  http://localhost:15672   (admin / admin)"; \
	 echo "  MinIO consola  http://minio.$$d |  http://localhost:9001     (minio / minio_dev_pw)"; \
	 echo "  S3 (firmado)   http://localhost:9000        (s3.$$d vía Traefik)"; \
	 echo "  Traefik        http://localhost:8080"; \
	 echo "  Grafana        http://localhost:3300        (solo con make up-obs)"; \
	 echo "  Demo (make seed): admin@umsa.edu.bo mod@umsa.edu.bo org@umsa.edu.bo lucia@umsa.edu.bo marco@umsa.edu.bo  /  Bandada#2026"; \
	 echo ""

# ---------------------------------------------------------------------------
# Workspace multi-repo
# ---------------------------------------------------------------------------
clone-all: ## Clona los 8 repos hermanos: make clone-all OWNER=<org-o-usuario-github>
	@test -n "$(OWNER)" || { echo "uso: make clone-all OWNER=<owner>"; exit 1; }
	@cd .. && bash bandadau-infra/scripts/clone-all.sh $(OWNER)
