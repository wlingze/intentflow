import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  type Dispatch,
  type ReactNode,
} from 'react';
import { fetchPayload } from '../lib/api';
import { loadPersisted, reviewStorageKey, savePersisted } from '../lib/persistence';
import type {
  Comment,
  Payload,
  PersistedReview,
  Quote,
  Side,
} from '../types';

export type RightTab = 'signals' | 'review';
export type DrawerMode = 'diff' | 'search';
export type DiffLayout = 'split' | 'unified';

export interface Selected {
  kind: 'node' | 'edge';
  id: string;
}

export interface DrawerState {
  open: boolean;
  files: string[];
  active: string | null;
  mode: DrawerMode;
  layout: DiffLayout;
  line?: number;
  side?: Side;
  search: string;
}

export interface ComposerState {
  quote: Quote | null;
  text: string;
  focusToken: number;
}

export interface ToastState {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'error';
}

export interface AppState {
  payload: Payload | null;
  loading: boolean;
  error: string | null;
  rightTab: RightTab;
  selected: Selected | null;
  comments: Comment[];
  dismissed: string[];
  kept: string[];
  composer: ComposerState;
  drawer: DrawerState;
  onlyChanged: boolean;
  toast: ToastState | null;
  toastSeq: number;
}

export type Action =
  | { type: 'payload/loaded'; payload: Payload; persisted: PersistedReview | null }
  | { type: 'payload/error'; error: string }
  | { type: 'tab/set'; tab: RightTab }
  | { type: 'select'; selected: Selected | null }
  | { type: 'composer/quote'; quote: Quote }
  | { type: 'composer/clearQuote' }
  | { type: 'composer/text'; text: string }
  | { type: 'comment/add'; comment: Comment }
  | { type: 'comment/update'; id: string; text: string }
  | { type: 'comment/delete'; id: string }
  | { type: 'signal/dismiss'; id: string }
  | { type: 'signal/undismiss'; id: string }
  | { type: 'signal/keep'; id: string; comment?: Comment }
  | { type: 'drawer/open'; file?: string; line?: number; side?: Side; mode?: DrawerMode }
  | { type: 'drawer/close' }
  | { type: 'drawer/file'; file: string }
  | { type: 'drawer/closeFile'; file: string }
  | { type: 'drawer/mode'; mode: DrawerMode }
  | { type: 'drawer/layout'; layout: DiffLayout }
  | { type: 'drawer/search'; search: string }
  | { type: 'drawer/target'; file?: string; line: number; side?: Side }
  | { type: 'onlyChanged'; value: boolean }
  | { type: 'toast/show'; message: string; kind?: ToastState['kind'] }
  | { type: 'toast/clear'; id: number };

const initialState: AppState = {
  payload: null,
  loading: true,
  error: null,
  rightTab: 'signals',
  selected: null,
  comments: [],
  dismissed: [],
  kept: [],
  composer: { quote: null, text: '', focusToken: 0 },
  drawer: {
    open: false,
    files: [],
    active: null,
    mode: 'diff',
    layout: 'unified',
    search: '',
  },
  onlyChanged: true,
  toast: null,
  toastSeq: 0,
};

function addUnique(list: string[], value: string, max = 8): string[] {
  const next = list.filter((item) => item !== value);
  next.push(value);
  return next.slice(-max);
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'payload/loaded':
      return {
        ...state,
        payload: action.payload,
        loading: false,
        error: null,
        comments: action.persisted?.comments ?? [],
        dismissed: action.persisted?.dismissed ?? [],
        kept: action.persisted?.kept ?? [],
      };
    case 'payload/error':
      return { ...state, loading: false, error: action.error };
    case 'tab/set':
      return { ...state, rightTab: action.tab };
    case 'select':
      return { ...state, selected: action.selected };
    case 'composer/quote':
      return {
        ...state,
        composer: {
          ...state.composer,
          quote: action.quote,
          focusToken: state.composer.focusToken + 1,
        },
      };
    case 'composer/clearQuote':
      return { ...state, composer: { ...state.composer, quote: null } };
    case 'composer/text':
      return { ...state, composer: { ...state.composer, text: action.text } };
    case 'comment/add':
      return {
        ...state,
        comments: [action.comment, ...state.comments],
        rightTab: 'review',
        composer: { ...state.composer, quote: null, text: '' },
      };
    case 'comment/update':
      return {
        ...state,
        comments: state.comments.map((comment) =>
          comment.id === action.id ? { ...comment, text: action.text } : comment,
        ),
      };
    case 'comment/delete':
      return { ...state, comments: state.comments.filter((comment) => comment.id !== action.id) };
    case 'signal/dismiss':
      return {
        ...state,
        dismissed: state.dismissed.includes(action.id)
          ? state.dismissed
          : [...state.dismissed, action.id],
        kept: state.kept.filter((id) => id !== action.id),
      };
    case 'signal/undismiss':
      return { ...state, dismissed: state.dismissed.filter((id) => id !== action.id) };
    case 'signal/keep': {
      const comments = action.comment ? [action.comment, ...state.comments] : state.comments;
      return {
        ...state,
        comments,
        kept: state.kept.includes(action.id) ? state.kept : [...state.kept, action.id],
        dismissed: state.dismissed.filter((id) => id !== action.id),
        rightTab: 'review',
      };
    }
    case 'drawer/open': {
      const files = state.payload?.code.files ?? [];
      const fallback =
        state.drawer.active ??
        files.find((file) => file.status !== 'unchanged')?.path ??
        files[0]?.path;
      const file = action.file ?? fallback;
      if (!file) return state;
      return {
        ...state,
        drawer: {
          ...state.drawer,
          open: true,
          active: file,
          files: addUnique(state.drawer.files, file),
          mode: action.mode ?? 'diff',
          line: action.line,
          side: action.side,
        },
      };
    }
    case 'drawer/close':
      return { ...state, drawer: { ...state.drawer, open: false } };
    case 'drawer/file':
      return {
        ...state,
        drawer: {
          ...state.drawer,
          open: true,
          active: action.file,
          files: addUnique(state.drawer.files, action.file),
        },
      };
    case 'drawer/closeFile': {
      const files = state.drawer.files.filter((file) => file !== action.file);
      const active = state.drawer.active === action.file ? files[files.length - 1] ?? null : state.drawer.active;
      return {
        ...state,
        drawer: {
          ...state.drawer,
          files,
          active,
          open: Boolean(active),
        },
      };
    }
    case 'drawer/mode':
      return { ...state, drawer: { ...state.drawer, mode: action.mode, open: true } };
    case 'drawer/layout':
      return { ...state, drawer: { ...state.drawer, layout: action.layout } };
    case 'drawer/search':
      return { ...state, drawer: { ...state.drawer, search: action.search } };
    case 'drawer/target': {
      const file = action.file ?? state.drawer.active;
      if (!file) return state;
      return {
        ...state,
        drawer: {
          ...state.drawer,
          open: true,
          active: file,
          files: addUnique(state.drawer.files, file),
          mode: 'diff',
          line: action.line,
          side: action.side,
        },
      };
    }
    case 'onlyChanged':
      return { ...state, onlyChanged: action.value };
    case 'toast/show': {
      const id = state.toastSeq + 1;
      return {
        ...state,
        toastSeq: id,
        toast: { id, message: action.message, kind: action.kind ?? 'info' },
      };
    }
    case 'toast/clear':
      return state.toast?.id === action.id ? { ...state, toast: null } : state;
    default:
      return state;
  }
}

const StateContext = createContext<AppState | null>(null);
const DispatchContext = createContext<Dispatch<Action> | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    let cancelled = false;
    fetchPayload()
      .then((payload) => {
        if (cancelled) return;
        const persisted = loadPersisted(reviewStorageKey(payload.review.before, payload.review.after));
        dispatch({ type: 'payload/loaded', payload, persisted });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        dispatch({ type: 'payload/error', error: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!state.payload) return;
    savePersisted(reviewStorageKey(state.payload.review.before, state.payload.review.after), {
      comments: state.comments,
      dismissed: state.dismissed,
      kept: state.kept,
    });
  }, [state.payload, state.comments, state.dismissed, state.kept]);

  useEffect(() => {
    if (!state.toast) return;
    const id = state.toast.id;
    const timer = window.setTimeout(() => dispatch({ type: 'toast/clear', id }), 3200);
    return () => window.clearTimeout(timer);
  }, [state.toast]);

  return (
    <StateContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>{children}</DispatchContext.Provider>
    </StateContext.Provider>
  );
}

export function useApp(): AppState {
  const state = useContext(StateContext);
  if (!state) throw new Error('useApp 必须在 AppProvider 内使用');
  return state;
}

export function useAppDispatch(): Dispatch<Action> {
  const dispatch = useContext(DispatchContext);
  if (!dispatch) throw new Error('useAppDispatch 必须在 AppProvider 内使用');
  return dispatch;
}
