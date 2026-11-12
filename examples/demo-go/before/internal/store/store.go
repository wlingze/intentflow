package store

import "database/sql"

var db *sql.DB

func FindUser(name string) (string, error) {
	var id string
	err := db.QueryRow("SELECT id FROM users WHERE name = ?", name).Scan(&id)
	return id, err
}
