package store

import (
	"database/sql"
	"fmt"
	"strings"
)

var db *sql.DB

func FindUser(name string) (string, error) {
	var query string
	switch {
	case strings.Contains(name, "@"):
		query = fmt.Sprintf("SELECT id FROM users WHERE email LIKE '%%%s%%'", name)
	default:
		query = fmt.Sprintf("SELECT id FROM users WHERE name LIKE '%%%s%%'", name)
	}
	rows, err := db.Query(query)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	return "", nil
}
