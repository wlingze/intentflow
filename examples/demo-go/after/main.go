package main

import (
	"database/sql"
	"fmt"
	"net/http"
	"os"
)

var db *sql.DB

func findUser(name string) (string, error) {
	query := fmt.Sprintf("SELECT id FROM users WHERE name LIKE '%%%s%%'", name)
	rows, err := db.Query(query)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	return "", nil
}

func loadTemplate() (string, error) {
	base := os.Getenv("APP_HOME")
	data, err := os.ReadFile(base + "/templates/search.html")
	return string(data), err
}

func handleSearch(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("name")
	id, err := findUser(name)
	if err != nil {
		http.Error(w, "not found", http.StatusInternalServerError)
		return
	}
	tpl, _ := loadTemplate()
	w.Write([]byte(tpl + id))
}

func main() {
	http.HandleFunc("/search", handleSearch)
	http.ListenAndServe(":8080", nil)
}
