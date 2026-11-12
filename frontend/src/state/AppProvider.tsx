import { createContext, useContext, useEffect, useReducer, type Dispatch, type ReactNode } from 'react';
import { fetchPayload, fetchRevisions } from '../lib/api';
import { loadLocalReview, saveLocalReview } from '../lib/localReview';
import { sameList } from '../lib/visibleFiles';
import { loadPrefs, savePrefs } from '../lib/prefs';
import type { Comment, DiffLayout, Payload, ReviewSession, RevisionList, Side } from '../types';

export interface CodeState {
  reveal: { file: string; token: number } | null;
  revealToken: number;
  line?: number;
  side?: Side;
  layout: DiffLayout;
  wrap: boolean;
  word: string;
  /** Files whose card is on screen right now; the tree greys them. */
  visible: string[];
  /** Files close enough to the viewport that their rows are mounted. */
  mounted: string[];
}
export interface ToastState { id: number; message: string; kind: 'info' | 'success' | 'error' }
export interface AppState {
  payload: Payload | null;
  loading: boolean;
  error: string | null;
  revisions: RevisionList | null;
  revisionId: string;
  revisionLoading: string | null;
  panels: { files: boolean; right: boolean };
  rightTab: 'ai' | 'signals' | 'review';
  drawer: 'left' | 'right' | null;
  comments: Comment[];
  viewed: string[];
  reviewedHunks: string[];
  editVersion: number;
  savedVersion: number;
  saveStatus: 'saved' | 'saving' | 'error';
  saveError: string;
  code: CodeState;
  treeFocus: { path: string; token: number } | null;
  toast: ToastState | null;
  toastSeq: number;
}
export type Action =
  | { type: 'payload/loaded'; payload: Payload; id?: string }
  | { type: 'payload/error'; error: string }
  | { type: 'revisions/loaded'; revisions: RevisionList }
  | { type: 'revision/loading'; id: string }
  | { type: 'revision/error'; error: string }
  | { type: 'panel/toggle'; panel: 'files' | 'right' }
  | { type: 'tab/set'; tab: AppState['rightTab'] }
  | { type: 'drawer/set'; drawer: 'left' | 'right' | null }
  | { type: 'comment/add'; comment: Comment }
  | { type: 'comment/update'; id: string; text: string }
  | { type: 'comment/delete'; id: string }
  | { type: 'comment/resolve'; id: string; resolved: boolean }
  | { type: 'viewed/toggle'; entry: string }
  | { type: 'viewed/all'; value: boolean; entries: string[] }
  | { type: 'hunk/toggle'; key: string }
  | { type: 'hunk/replace'; file: string; keys: string[] }
  | { type: 'review/saving'; comparison: string }
  | { type: 'review/saved'; comparison: string; version: number; updatedAt: string }
  | { type: 'review/error'; comparison: string; error: string }
  | { type: 'review/imported'; document: ReviewSession }
  | { type: 'code/reveal'; file: string; line?: number; side?: Side }
  | { type: 'code/layout'; layout: DiffLayout }
  | { type: 'code/wrap'; wrap: boolean }
  | { type: 'code/word'; word: string }
  | { type: 'code/visible'; files: string[]; mounted: string[] }
  | { type: 'tree/focus'; path: string }
  | { type: 'toast/show'; message: string; kind?: ToastState['kind'] }
  | { type: 'toast/clear'; id: number };

const prefs = loadPrefs();
const initialState: AppState = {
  payload: null, loading: true, error: null, revisions: null, revisionId: '', revisionLoading: null,
  panels: { files: prefs.files, right: prefs.right }, rightTab: 'review', drawer: null,
  comments: [], viewed: [], reviewedHunks: [], editVersion: 0, savedVersion: 0,
  saveStatus: 'saved', saveError: '',
  code: { reveal: null, revealToken: 0, layout: 'split', wrap: prefs.wrap, word: '', visible: [], mounted: [] }, treeFocus: null, toast: null, toastSeq: 0,
};

export function reviewDocument(state: AppState): ReviewSession {
  if (!state.payload) throw new Error('未加载比较范围');
  // Build only known fields: older JSON may still carry summary/decision, and
  // the PUT decoder rejects unknown keys.
  const session = state.payload.session;
  return {
    version: session.version,
    context: session.context,
    comments: state.comments,
    viewed: state.viewed,
    reviewed_hunks: state.reviewedHunks,
    updated_at: session.updated_at,
  };
}

export async function saveCurrentReview(state: AppState, dispatch: Dispatch<Action>): Promise<ReviewSession> {
  const doc = reviewDocument(state);
  const comparison = doc.context.comparison_id;
  dispatch({ type: 'review/saving', comparison });
  try {
    // 评审状态存在浏览器里：工作台只读仓库，不往仓库写文件。
    saveLocalReview(doc);
    const updatedAt = new Date().toISOString();
    dispatch({ type: 'review/saved', comparison, version: state.editVersion, updatedAt });
    return { ...doc, updated_at: updatedAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dispatch({ type: 'review/error', comparison, error: message });
    throw error;
  }
}

function reducer(state: AppState, action: Action): AppState {
  const changed = (next: Partial<AppState>): AppState => ({ ...state, ...next, editVersion: state.editVersion + 1 });
  switch (action.type) {
    case 'payload/loaded': {
      const doc = action.payload.session;
      return { ...state, payload: action.payload, loading: false, error: null, revisionId: action.id ?? doc.context.revision,
        revisionLoading: null, comments: doc.comments,
        viewed: doc.viewed.filter((entry) => entry.includes('#')),
        reviewedHunks: (doc.reviewed_hunks ?? []).filter((entry) => entry.includes('#')),
        editVersion: 0, savedVersion: 0, saveStatus: 'saved', saveError: '', code: { ...state.code, reveal: null, line: undefined, visible: [], mounted: [] },
      };
    }
    case 'payload/error': return { ...state, loading: false, error: action.error };
    case 'revisions/loaded': return { ...state, revisions: action.revisions };
    case 'revision/loading': return { ...state, revisionLoading: action.id };
    case 'revision/error': return { ...state, revisionLoading: null };
    case 'panel/toggle': return { ...state, panels: { ...state.panels, [action.panel]: !state.panels[action.panel] } };
    case 'tab/set': return { ...state, rightTab: action.tab };
    case 'drawer/set': return { ...state, drawer: action.drawer };
    case 'comment/add': return changed({ comments: [...state.comments, action.comment] });
    case 'comment/update': return changed({ comments: state.comments.map((c) => c.id === action.id ? { ...c, text: action.text } : c) });
    case 'comment/resolve': return changed({ comments: state.comments.map((c) => c.id === action.id ? { ...c, resolved: action.resolved } : c) });
    case 'comment/delete': return changed({ comments: state.comments.filter((c) => c.id !== action.id) });
    case 'viewed/toggle': {
      const path = action.entry.split('#')[0];
      const rest = state.viewed.filter((entry) => !entry.startsWith(`${path}#`));
      return changed({ viewed: state.viewed.includes(action.entry) ? rest : [...rest, action.entry] });
    }
    case 'viewed/all': return changed({ viewed: action.value ? action.entries : [], reviewedHunks: action.value ? state.reviewedHunks : [] });
    case 'hunk/toggle': {
      const next = state.reviewedHunks.includes(action.key) ? state.reviewedHunks.filter((key) => key !== action.key) : [...state.reviewedHunks, action.key];
      return changed({ reviewedHunks: next });
    }
    case 'hunk/replace': {
      const others = state.reviewedHunks.filter((key) => !key.startsWith(`${action.file}@`));
      return changed({ reviewedHunks: [...others, ...action.keys] });
    }
    case 'review/saving': return action.comparison !== state.payload?.session.context.comparison_id ? state : { ...state, saveStatus: 'saving', saveError: '' };
    case 'review/saved': return action.comparison !== state.payload?.session.context.comparison_id ? state : {
      ...state, savedVersion: Math.max(state.savedVersion, action.version), saveStatus: 'saved', saveError: '',
      payload: { ...state.payload, session: { ...state.payload.session, updated_at: action.updatedAt } },
    };
    case 'review/error': return action.comparison !== state.payload?.session.context.comparison_id ? state : { ...state, saveStatus: 'error', saveError: action.error };
    case 'review/imported': return !state.payload ? state : { ...state, payload: { ...state.payload, session: action.document },
      comments: action.document.comments,
      viewed: action.document.viewed.filter((entry) => entry.includes('#')),
      reviewedHunks: (action.document.reviewed_hunks ?? []).filter((entry) => entry.includes('#')),
      editVersion: 0, savedVersion: 0, saveStatus: 'saved', saveError: '',
    };
    case 'code/reveal': return { ...state, drawer: null, code: { ...state.code, reveal: { file: action.file, token: state.code.revealToken + 1 }, revealToken: state.code.revealToken + 1, line: action.line, side: action.side ?? 'after' } };
    case 'code/layout': return { ...state, code: { ...state.code, layout: action.layout } };
    case 'code/wrap': return { ...state, code: { ...state.code, wrap: action.wrap } };
    case 'code/word': return { ...state, code: { ...state.code, word: action.word } };
    case 'code/visible': {
      if (sameList(state.code.visible, action.files) && sameList(state.code.mounted, action.mounted)) return state;
      return { ...state, code: { ...state.code, visible: action.files, mounted: action.mounted } };
    }
    case 'tree/focus': return { ...state, treeFocus: { path: action.path, token: (state.treeFocus?.token ?? 0) + 1 } };
    case 'toast/show': return { ...state, toast: { id: state.toastSeq + 1, message: action.message, kind: action.kind ?? 'info' }, toastSeq: state.toastSeq + 1 };
    case 'toast/clear': return state.toast?.id === action.id ? { ...state, toast: null } : state;
    default: return state;
  }
}

const StateContext = createContext<AppState | null>(null);
const DispatchContext = createContext<Dispatch<Action> | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  useEffect(() => {
    let cancelled = false;
    fetchPayload().then((payload) => {
      if (cancelled) return;
      // 浏览器里存着同一比较范围的记录时以它为准，服务端只给空文档。
      const local = loadLocalReview(payload.session.context);
      dispatch({ type: 'payload/loaded', payload: local ? { ...payload, session: local } : payload });
    })
      .catch((error: unknown) => { if (!cancelled) dispatch({ type: 'payload/error', error: error instanceof Error ? error.message : String(error) }); });
    fetchRevisions().then((revisions) => { if (!cancelled) dispatch({ type: 'revisions/loaded', revisions }); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!state.payload || state.editVersion <= state.savedVersion || state.revisionLoading || state.saveStatus === 'error' || state.saveStatus === 'saving') return;
    const timer = window.setTimeout(() => { void saveCurrentReview(state, dispatch).catch(() => undefined); }, 400);
    return () => window.clearTimeout(timer);
  }, [state.payload?.session.context.comparison_id, state.editVersion, state.savedVersion, state.revisionLoading, state.saveStatus]);

  useEffect(() => {
    if (state.editVersion <= state.savedVersion) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [state.editVersion, state.savedVersion]);
  useEffect(() => { savePrefs({ ...state.panels, wrap: state.code.wrap }); }, [state.panels, state.code.wrap]);
  useEffect(() => {
    if (!state.toast) return;
    const id = state.toast.id;
    const timer = window.setTimeout(() => dispatch({ type: 'toast/clear', id }), 4500);
    return () => window.clearTimeout(timer);
  }, [state.toast]);
  return <StateContext.Provider value={state}><DispatchContext.Provider value={dispatch}>{children}</DispatchContext.Provider></StateContext.Provider>;
}
export function useApp(): AppState { const state = useContext(StateContext); if (!state) throw new Error('useApp 必须在 AppProvider 内使用'); return state; }
export function useAppDispatch(): Dispatch<Action> { const dispatch = useContext(DispatchContext); if (!dispatch) throw new Error('useAppDispatch 必须在 AppProvider 内使用'); return dispatch; }
