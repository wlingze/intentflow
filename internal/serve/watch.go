package serve

import (
	"sync"
	"time"
)

// Watcher polls a cheap repository fingerprint and broadcasts settled changes.
//
// A single poll can catch an editor mid-write. The watcher therefore waits
// until two polls agree after the settle window, so one save produces one
// event instead of several.
type Watcher struct {
	fingerprint func() (string, error)
	interval    time.Duration
	settle      time.Duration

	mu      sync.Mutex
	last    string
	subs    map[int]chan struct{}
	next    int
	started bool
	stop    chan struct{}
}

func NewWatcher(fingerprint func() (string, error)) *Watcher {
	return &Watcher{
		fingerprint: fingerprint,
		interval:    time.Second,
		settle:      time.Second,
		subs:        map[int]chan struct{}{},
		stop:        make(chan struct{}),
	}
}

// Subscribe returns a coalescing channel: if the client is slow, changes
// collapse into one pending notification instead of queueing forever.
func (w *Watcher) Subscribe() (<-chan struct{}, func()) {
	ch := make(chan struct{}, 1)
	w.mu.Lock()
	id := w.next
	w.next++
	w.subs[id] = ch
	if !w.started {
		w.started = true
		go w.run()
	}
	w.mu.Unlock()
	var once sync.Once
	return ch, func() {
		once.Do(func() {
			w.mu.Lock()
			delete(w.subs, id)
			w.mu.Unlock()
		})
	}
}

// Stop ends the polling loop. Tests use it; the server process exits anyway.
func (w *Watcher) Stop() {
	select {
	case <-w.stop:
	default:
		close(w.stop)
	}
}

func (w *Watcher) hasSubscribers() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return len(w.subs) > 0
}

func (w *Watcher) run() {
	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()
	// The first successful read is the baseline, not an event: opening the
	// page must not report a change that happened before it subscribed.
	last := ""
	if fp, err := w.fingerprint(); err == nil {
		last = fp
		w.mu.Lock()
		w.last = fp
		w.mu.Unlock()
	}
	pending := ""
	var since time.Time
	for {
		select {
		case <-w.stop:
			return
		case <-ticker.C:
		}
		// No page is listening; skip git entirely.
		if !w.hasSubscribers() {
			pending = ""
			continue
		}
		fp, err := w.fingerprint()
		if err != nil {
			continue
		}
		if fp == last {
			pending = ""
			continue
		}
		if fp != pending {
			pending, since = fp, time.Now()
			continue
		}
		if time.Since(since) < w.settle {
			continue
		}
		last = fp
		pending = ""
		w.mu.Lock()
		w.last = fp
		for _, ch := range w.subs {
			select {
			case ch <- struct{}{}:
			default:
			}
		}
		w.mu.Unlock()
	}
}
