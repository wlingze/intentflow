GO ?= go
PNPM ?= pnpm
OAPI ?= $(shell $(GO) env GOPATH)/bin/oapi-codegen
OAPI_VERSION ?= v2.4.1
DEMO_BEFORE ?= examples/demo-go/before
DEMO_AFTER ?= examples/demo-go/after
DEMO_OUT ?= examples/demo-go/out
ADDR ?= 127.0.0.1:8123
E2E_URL ?= http://127.0.0.1:8123

.PHONY: tools schema frontend build check e2e demo serve clean

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
# 需要已启动的服务与全局 playwright：NODE_PATH=~/.local/lib/node_modules/@playwright/cli/node_modules
e2e:
	NODE_PATH=$$HOME/.local/lib/node_modules/@playwright/cli/node_modules node scripts/e2e/render.mjs $(E2E_URL)

# 生成 demo 的 review.json（行为图也在这里）。
demo:
	$(GO) build -o bin/intentflow ./cmd/intentflow
	./bin/intentflow diff --before $(DEMO_BEFORE) --after $(DEMO_AFTER) --out $(DEMO_OUT)

# 分析后直接启动工作台。前端产物必须已构建。
serve: build
	./bin/intentflow serve --before $(DEMO_BEFORE) --after $(DEMO_AFTER) --out $(DEMO_OUT) --addr $(ADDR)

# 不提供 rm -rf：需要清理时请手动确认路径后删除。
clean:
	$(GO) clean
	@echo "bin/ 与 frontend/dist/ 保留，避免误删"
