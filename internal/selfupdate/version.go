package selfupdate

import (
	"fmt"
	"strconv"
	"strings"
)

// semver 是去掉 v 前缀与构建元数据的版本号，只用于比较。
// 发布 tag 形如 v0.2.0；开发构建可能是 dev 或 git describe 的输出，
// 这些值无法解析，调用方按「未知版本」处理。
type semver struct {
	major, minor, patch int
	pre                 []string
}

// parseVersion 接受 0.2.0、v0.2.0、v0.2.0-rc.1 与 v0.2.0+build.7。
func parseVersion(s string) (semver, error) {
	raw := strings.TrimSpace(s)
	raw = strings.TrimPrefix(raw, "v")
	if i := strings.IndexByte(raw, '+'); i >= 0 {
		raw = raw[:i]
	}
	var pre []string
	if i := strings.IndexByte(raw, '-'); i >= 0 {
		pre = strings.Split(raw[i+1:], ".")
		raw = raw[:i]
		for _, p := range pre {
			if p == "" {
				return semver{}, fmt.Errorf("版本 %q 不合法", s)
			}
		}
	}
	parts := strings.Split(raw, ".")
	if len(parts) != 3 {
		return semver{}, fmt.Errorf("版本 %q 不是 X.Y.Z 形式", s)
	}
	var nums [3]int
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 || strings.HasPrefix(p, "+") {
			return semver{}, fmt.Errorf("版本 %q 里的 %q 不是数字", s, p)
		}
		nums[i] = n
	}
	return semver{major: nums[0], minor: nums[1], patch: nums[2], pre: pre}, nil
}

// Compare 按语义化版本规则比较：负数表示 v 更旧，0 表示相等。
func (v semver) Compare(o semver) int {
	for _, pair := range [][2]int{{v.major, o.major}, {v.minor, o.minor}, {v.patch, o.patch}} {
		if pair[0] != pair[1] {
			if pair[0] < pair[1] {
				return -1
			}
			return 1
		}
	}
	return comparePre(v.pre, o.pre)
}

// comparePre 实现 semver 的预发布比较：正式版高于预发布版；
// 数字标识按数值比较，数字标识低于字母标识。
func comparePre(a, b []string) int {
	switch {
	case len(a) == 0 && len(b) == 0:
		return 0
	case len(a) == 0:
		return 1
	case len(b) == 0:
		return -1
	}
	for i := 0; i < len(a) && i < len(b); i++ {
		x, y := a[i], b[i]
		xn, xerr := strconv.Atoi(x)
		yn, yerr := strconv.Atoi(y)
		switch {
		case xerr == nil && yerr == nil:
			if xn != yn {
				if xn < yn {
					return -1
				}
				return 1
			}
		case xerr == nil:
			return -1
		case yerr == nil:
			return 1
		default:
			if x != y {
				if x < y {
					return -1
				}
				return 1
			}
		}
	}
	switch {
	case len(a) < len(b):
		return -1
	case len(a) > len(b):
		return 1
	}
	return 0
}

// normalizeTag 把 --version 的输入补成发布 tag 的形式。
func normalizeTag(s string) (string, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", fmt.Errorf("版本号不能为空")
	}
	if !strings.HasPrefix(s, "v") {
		s = "v" + s
	}
	if _, err := parseVersion(s); err != nil {
		return "", err
	}
	return s, nil
}
