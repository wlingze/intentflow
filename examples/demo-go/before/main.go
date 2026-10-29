package main

import (
	"database/sql"
	"net/http"
)

var db *sql.DB

func findUser(name string) (string, error) {
	var id string
	err := db.QueryRow("SELECT id FROM users WHERE name = ?", name).Scan(&id)
	return id, err
}

func handleSearch(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("name")
	id, err := findUser(name)
	if err != nil {
		http.Error(w, "not found", http.StatusInternalServerError)
		return
	}
	w.Write([]byte(id))
}

func main() {
	http.HandleFunc("/search", handleSearch)
	http.ListenAndServe(":8080", nil)
}
