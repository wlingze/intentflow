package reviewflow

import (
	"context"
	"sync"
	"time"
)

// Outcome is the single terminal event of a review wait.
type Outcome struct {
	Status     string
	Reason     string
	Message    string
	Submission Submission
	At         time.Time
}

// Waiter settles exactly once: a submission, a cancel, a timeout or an
// interruption. It also tracks browser presence so closing every page can
// cancel the wait.
type Waiter struct {
	mu      sync.Mutex
	outcome *Outcome
	events  chan Outcome
	done    chan struct{}

	clients       int
	everConnected bool
	grace         time.Duration
	timer         *time.Timer
}

// Options configures presence handling.
type Options struct {
	// Grace is how long the last page may stay disconnected before the wait
	// is cancelled. Zero uses 5s; a negative value disables page-close cancel.
	Grace time.Duration
}

func NewWaiter(opts Options) *Waiter {
	grace := opts.Grace
	if grace == 0 {
		grace = 5 * time.Second
	}
	return &Waiter{
		events: make(chan Outcome, 1),
		done:   make(chan struct{}),
		grace:  grace,
	}
}

// Submit settles the wait with a validated submission. It refuses a second
// settlement.
func (w *Waiter) Submit(sub Submission) bool {
	return w.settle(Outcome{Status: StatusSubmitted, Submission: sub, At: time.Now().UTC()})
}

// Cancel settles the wait as cancelled.
func (w *Waiter) Cancel(reason, message string) bool {
	return w.settle(Outcome{Status: StatusCancelled, Reason: reason, Message: message, At: time.Now().UTC()})
}

// Wait blocks until the waiter settles or ctx ends. onContextDone builds the
// outcome used when ctx wins; it is passed through settle so a submission that
// arrives at the same moment still wins exactly once.
func (w *Waiter) Wait(ctx context.Context, onContextDone func() Outcome) Outcome {
	select {
	case outcome := <-w.events:
		return outcome
	case <-ctx.Done():
		fallback := onContextDone()
		if w.settle(fallback) {
			return fallback
		}
		return <-w.events
	}
}

// Done is closed after the first settlement.
func (w *Waiter) Done() <-chan struct{} { return w.done }

// Settled reports whether the waiter already has an outcome.
func (w *Waiter) Settled() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.outcome != nil
}

// ClientConnected registers a browser event stream.
func (w *Waiter) ClientConnected() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.clients++
	w.everConnected = true
	if w.timer != nil {
		w.timer.Stop()
		w.timer = nil
	}
}

// ClientDisconnected unregisters a browser event stream. When the last page
// leaves and no submission arrived within the grace period, the wait becomes
// cancelled: a closed tab must not strand an agent forever.
func (w *Waiter) ClientDisconnected() {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.clients > 0 {
		w.clients--
	}
	if w.clients != 0 || !w.everConnected || w.outcome != nil || w.grace < 0 {
		return
	}
	if w.timer != nil {
		w.timer.Stop()
	}
	w.timer = time.AfterFunc(w.grace, func() {
		w.Cancel(ReasonPageClosed, "审阅页面已关闭，未提交评审")
	})
}

func (w *Waiter) settle(outcome Outcome) bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.outcome != nil {
		return false
	}
	if outcome.At.IsZero() {
		outcome.At = time.Now().UTC()
	}
	if outcome.Status == StatusSubmitted && outcome.Submission.Comments == nil {
		outcome.Submission.Comments = []Comment{}
	}
	w.outcome = &outcome
	if w.timer != nil {
		w.timer.Stop()
		w.timer = nil
	}
	close(w.done)
	w.events <- outcome
	return true
}
