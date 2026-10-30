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
import { loadPrefs, savePrefs } from '../lib/prefs';
import type {
  Comment,
  DeltaKind,
  DiffLayout,
  Payload,
  PersistedReview,
  Quote,
  Selection,
  Side,
  ViewMode,
  CodeMode,
} from '../types';

export type RightTab = 'ai' | 'signals' | 'review';

export interface CodeState {
  files: string[];
  active: string | null;
  mode: CodeMode;
  layout: DiffLayout;
  wrap: boolean;
  line?: number;
  side?: Side;
  search: string;
}

export interface PanelState {
  files: boolean;
  graph: boolean;
}

export interface PeekState {
  open: boolean;
  nodeId?: string;
  edgeId?: string;
  file?: string;
  line?: number;
  side?: Side;
  delta?: DeltaKind;
  function?: string;
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
  view: ViewMode;
  rightTab: RightTab;
  panels: PanelState;
  drawer: 'left' | 'right' | null;
  selected: Selection | null;
  peek: PeekState;
  comments: Comment[];
  dismissed: string[];
  kept: string[];
  composer: ComposerState;
  code: CodeState;
  onlyChanged: boolean;
  toast: ToastState | null;
  toastSeq: number;
}

export type Action =
  | { type: 'payload/loaded'; payload: Payload; persisted: PersistedReview | null }
  | { type: 'payload/error'; error: string }
  | { type: 'view/set'; view: ViewMode }
  | { type: 'tab/set'; tab: RightTab }
  | { type: 'panel/toggle'; panel: keyof PanelState }
  | { type: 'drawer/set'; drawer: 'left' | 'right' | null }
  | { type: 'payload/refresh'; payload: Payload }
  | { type: 'select'; selected: Selection | null }
  | { type: 'peek/open'; nodeId?: string; edgeId?: string; file?: string; line?: number; side?: Side; delta?: DeltaKind; function?: string }
  | { type: 'peek/close' }
  | { type: 'composer/quote'; quote: Quote }
  | { type: 'composer/clearQuote' }
  | { type: 'composer/text'; text: string }
  | { type: 'comment/add'; comment: Comment }
  | { type: 'comment/update'; id: string; text: string }
  | { type: 'comment/delete'; id: string }
  | { type: 'signal/dismiss'; id: string }
  | { type: 'signal/undismiss'; id: string }
  | { type: 'signal/keep'; id: string; comment?: Comment }
  | { type: 'code/open'; file?: string; line?: number; side?: Side; mode?: CodeMode }
  | { type: 'code/close' }
  | { type: 'code/file'; file: string }
  | { type: 'code/closeFile'; file: string }
  | { type: 'code/mode'; mode: CodeMode }
  | { type: 'code/layout'; layout: DiffLayout }
  | { type: 'code/wrap'; wrap: boolean }
  | { type: 'code/search'; search: string }
  | { type: 'code/target'; file?: string; line: number; side?: Side }
  | { type: 'onlyChanged'; value: boolean }
  | { type: 'toast/show'; message: string; kind?: ToastState['kind'] }
  | { type: 'toast/clear'; id: number };

const initialPrefs = loadPrefs();

const initialState: AppState = {
  payload: null,
  loading: true,
  error: null,
  view: 'code',
  rightTab: 'ai',
  panels: { files: initialPrefs.files, graph: initialPrefs.graph },
  drawer: null,
  selected: null,
  peek: { open: false },
  comments: [],
  dismissed: [],
  kept: [],
  composer: { quote: null, text: '', focusToken: 0 },
  code: {
    files: [],
    active: null,
    mode: 'diff',
    layout: 'split',
    wrap: initialPrefs.wrap,
    search: '',
  },
  onlyChanged: true,
  toast: null,
  toastSeq: 0,
};

function addUnique(list: string[], value: string, max = 12): string[] {
  const next = list.filter((item) => item !== value);
  next.push(value);
  return next.slice(-max);
}

// Git 模式下 afterLabel 会随选择变化；用仓库+子树做 key，
// 否则换一个提交集合就看不到之前写的意见。
function storageKey(payload: Payload): string {
  const comparison = payload.review.comparison;
  if (comparison?.mode === 'git') {
    return `intentflow.review:git:${comparison.repo ?? ''}:${comparison.subdir ?? ''}`;
  }
  return reviewStorageKey(payload.review.before, payload.review.after);
}

function pickDefaultFile(payload: Payload): string | null {
  return (
    payload.code.files.find((file) => file.status !== 'unchanged')?.path ??
    payload.code.files[0]?.path ??
    null
  );
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'payload/loaded': {
      const active = pickDefaultFile(action.payload);
      return {
        ...state,
        payload: action.payload,
        loading: false,
        error: null,
        comments: action.persisted?.comments ?? [],
        dismissed: action.persisted?.dismissed ?? [],
        kept: action.persisted?.kept ?? [],
        rightTab: action.payload.review.ai?.status === 'ok' ? 'ai' : 'signals',
        view: 'code',
        code: {
          ...state.code,
          active,
          files: active ? [active] : [],
        },
      };
    }
    case 'payload/error':
      return { ...state, loading: false, error: action.error };
    case 'view/set':
      return {
        ...state,
        view: action.view,
        peek: action.view === 'code' ? { open: false } : state.peek,
      };
    case 'tab/set':
      return { ...state, rightTab: action.tab };
    case 'panel/toggle':
      return { ...state, panels: { ...state.panels, [action.panel]: !state.panels[action.panel] } };
    case 'drawer/set':
      return { ...state, drawer: action.drawer };
    case 'payload/refresh': {
      const active = pickDefaultFile(action.payload);
      return {
        ...state,
        payload: action.payload,
        loading: false,
        error: null,
        code: { ...state.code, active, files: active ? [active] : [], line: undefined },
      };
    }
    case 'select':
      return { ...state, selected: action.selected };
    case 'peek/open':
      return {
        ...state,
        peek: {
          open: true,
          nodeId: action.nodeId,
          edgeId: action.edgeId,
          file: action.file,
          line: action.line,
          side: action.side ?? 'after',
          delta: action.delta,
          function: action.function,
        },
      };
    case 'peek/close':
      return { ...state, peek: { open: false } };
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
    case 'code/open': {
      const fallback =
        action.file ??
        state.code.active ??
        (state.payload ? pickDefaultFile(state.payload) : null);
      if (!fallback) return state;
      return {
        ...state,
        view: 'code',
        peek: { open: false },
        code: {
          ...state.code,
          active: fallback,
          files: addUnique(state.code.files, fallback),
          mode: action.mode ?? 'diff',
          line: action.line,
          side: action.side,
        },
      };
    }
    case 'code/close':
      return { ...state, view: 'code', peek: { open: false } };
    case 'code/file':
      return {
        ...state,
        view: 'code',
        code: {
          ...state.code,
          active: action.file,
          files: addUnique(state.code.files, action.file),
          line: undefined,
        },
      };
    case 'code/closeFile': {
      const files = state.code.files.filter((file) => file !== action.file);
      const active =
        state.code.active === action.file ? files[files.length - 1] ?? null : state.code.active;
      return {
        ...state,
        code: {
          ...state.code,
          files,
          active,
          line: state.code.active === action.file ? undefined : state.code.line,
        },
      };
    }
    case 'code/mode':
      return { ...state, code: { ...state.code, mode: action.mode } };
    case 'code/layout':
      return { ...state, code: { ...state.code, layout: action.layout } };
    case 'code/wrap':
      return { ...state, code: { ...state.code, wrap: action.wrap } };
    case 'code/search':
      return { ...state, code: { ...state.code, search: action.search } };
    case 'code/target': {
      const file = action.file ?? state.code.active;
      if (!file) return state;
      return {
        ...state,
        view: 'code',
        peek: { open: false },
        code: {
          ...state.code,
          active: file,
          files: addUnique(state.code.files, file),
          mode: 'diff',
          line: action.line,
          side: action.side ?? 'after',
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
        const persisted = loadPersisted(storageKey(payload));
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
    savePrefs({ ...state.panels, wrap: state.code.wrap });
  }, [state.panels, state.code.wrap]);

  useEffect(() => {
    if (!state.payload) return;
    savePersisted(storageKey(state.payload), {
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
