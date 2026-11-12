package main

import (
	"net/http"
	"os"

	"demo/internal/store"
)

func loadTemplate() (string, error) {
	base := os.Getenv("APP_HOME")
	data, err := os.ReadFile(base + "/templates/search.html")
	return string(data), err
}

func handleSearch(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("name")
	if name == "" {
		http.Error(w, "name is required", http.StatusBadRequest)
		return
	}
	id, err := store.FindUser(name)
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
