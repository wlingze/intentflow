package store

import "log"

// RecordSearch keeps one line per query so a risky call is visible in logs.
func RecordSearch(name, query string) {
	log.Printf("search name=%q query=%q", name, query)
}
