GO ?= go
PNPM ?= pnpm
OAPI ?= $(shell $(GO) env GOPATH)/bin/oapi-codegen
OAPI_VERSION ?= v2.4.1
DEMO_BEFORE ?= examples/demo-go/before
DEMO_AFTER ?= examples/demo-go/after
DEMO_OUT ?= examples/demo-go/out
ADDR ?= 127.0.0.1:8123
E2E_URL ?= http://127.0.0.1:8123
# e2e 需要 Playwright。NODE_PATH 指向全局安装的包，没有就退回本地解析。
PLAYWRIGHT_PATH ?= $(HOME)/.local/lib/node_modules/@playwright/cli/node_modules

.PHONY: tools schema frontend build check e2e demo serve release-check clean

# 一次性安装生成器。oapi-codegen 固定在 v2.4.1，避免生成物漂移。
tools:
	$(GO) install github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@$(OAPI_VERSION)
	cd frontend && $(PNPM) install

# 唯一事实来源：schema/openapi.yaml。生成 Go 与 TS 两侧类型。
schema:
	$(OAPI) -config oapi-codegen.yaml schema/openapi.yaml
	cd frontend && $(PNPM) exec openapi-typescript ../schema/openapi.yaml -o src/api/schema.gen.ts

frontend:
	cd frontend && $(PNPM) build

build:
	./scripts/build.sh

check:
	$(GO) vet ./...
	$(GO) test ./cmd/... ./internal/...
	cd frontend && $(PNPM) typecheck
	cd frontend && $(PNPM) test

# 渲染层检查：真实布局下的滚动、行内标记、文件树色调与跳转。
# 需要已启动的服务，以及 Playwright（全局或本地安装均可，用 PLAYWRIGHT_PATH 覆盖）。
e2e:
	NODE_PATH=$(PLAYWRIGHT_PATH) node scripts/e2e/render.mjs $(E2E_URL)

# 生成 demo 的 review.json。
demo:
	$(GO) build -o bin/intentflow ./cmd/intentflow
	./bin/intentflow diff --before $(DEMO_BEFORE) --after $(DEMO_AFTER) --out $(DEMO_OUT)

# 分析后直接启动工作台。前端已嵌进二进制，不需要 dist 目录。
serve: build
	./bin/intentflow --before $(DEMO_BEFORE) --after $(DEMO_AFTER) --host 127.0.0.1 --port 8123

# 本地验证发布：六个平台都能交叉编译，且版本号注入生效。
release-check:
	@for target in linux/amd64 linux/arm64 darwin/amd64 darwin/arm64 windows/amd64 windows/arm64; do \
	  os=$${target%/*}; arch=$${target#*/}; \
	  CGO_ENABLED=0 GOOS=$$os GOARCH=$$arch $(GO) build -trimpath \
	    -ldflags "-s -w -X github.com/wlingze/intentflow/internal/version.Version=0.1.0-check" \
	    -o /tmp/intentflow-$$os-$$arch ./cmd/intentflow || exit 1; \
	  echo "ok $$os/$$arch"; \
	done

# 不提供 rm -rf：需要清理时请手动确认路径后删除。
clean:
	$(GO) clean
	@echo "bin/ 与 frontend/dist/ 保留，避免误删"
