package payload

import "testing"

func TestLanguageOf(t *testing.T) {
	cases := map[string]string{
		"src/main.c":          "c",
		"include/api.h":       "c",
		"src/view.cc":         "cpp",
		"src/view.cpp":        "cpp",
		"src/view.cxx":        "cpp",
		"include/view.hpp":    "cpp",
		"src/Model.cs":        "csharp",
		"src/main.go":         "go",
		"src/lib.rs":          "rust",
		"src/App.java":        "java",
		"src/App.kt":          "kotlin",
		"build.gradle.kts":    "kotlin",
		"src/Main.scala":      "scala",
		"app/main.py":         "python",
		"web/app.js":          "javascript",
		"web/app.mjs":         "javascript",
		"web/App.jsx":         "jsx",
		"web/app.ts":          "typescript",
		"web/App.tsx":         "tsx",
		"api/index.php":       "php",
		"lib/task.rb":         "ruby",
		"ios/App.swift":       "swift",
		"src/init.lua":        "lua",
		"scripts/run.sh":      "shell",
		"scripts/run.bash":    "shell",
		"scripts/run.zsh":     "shell",
		"db/schema.sql":       "sql",
		"ci/build.yaml":       "yaml",
		"ci/build.yml":        "yaml",
		"conf/app.json":       "json",
		"conf/app.toml":       "toml",
		"conf/app.xml":        "xml",
		"web/index.html":      "html",
		"web/app.css":         "css",
		"web/app.scss":        "scss",
		"docs/readme.md":      "markdown",
		"Dockerfile":          "docker",
		"deploy/Dockerfile":   "docker",
		"Makefile":            "makefile",
		"rules.mk":            "makefile",
		"CMakeLists.txt":      "cmake",
		"cmake/Deps.cmake":    "cmake",
		"build.gradle":        "groovy",
		"infra/main.tf":       "hcl",
		"infra/prod.tfvars":   "hcl",
		"proto/event.proto":   "protobuf",
		"notes.txt":           "text",
		"assets/logo.unknown": "unknown",
		"UPPER/MAIN.C":        "c",
	}
	for path, want := range cases {
		if got := languageOf(path); got != want {
			t.Errorf("languageOf(%q) = %q, want %q", path, got, want)
		}
	}
}
