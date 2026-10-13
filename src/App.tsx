import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import type { DataType, Step, ProcessedRow } from './types';
import { SCHEMAS, TITLE_OPTIONS, PAYMENT_TERMS_OPTIONS } from './constants';
import { normalizeCurrency } from './utils/normalization';
import { runProcessData } from './utils/processData';
import { X } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { FileUploader } from './components/FileUploader';
import { RulesModal } from './components/RulesModal';
import { RowEditor } from './components/RowEditor';
import { CellarAutocomplete } from './components/CellarAutocomplete';
import { DuplicateComparisonModal } from './components/DuplicateComparisonModal';
import { AddLocationModal } from './components/AddLocationModal';
import { AiFixReviewModal } from './components/AiFixReviewModal';
import { AppHeader } from './components/AppHeader';
import { UploadStep } from './components/UploadStep';
import { ReviewTable } from './components/ReviewTable';
import { ColumnPickerModal } from './components/ColumnPickerModal';
import { ValidationProgressOverlay } from './components/ValidationProgressOverlay';
import { rowsToCsv, downloadBlob, downloadCsv, downloadTemplate } from './utils/exportUtils';

// Lazy-loaded: only pulled in when the user actually reaches that step or panel.
// ExcelJS is imported dynamically inside handleDownloadTemplate for the same reason.
const AdminPanel     = React.lazy(() => import('./components/AdminPanel').then(m => ({ default: m.AdminPanel })));
const ManualEntryGrid = React.lazy(() => import('./components/ManualEntryGrid').then(m => ({ default: m.ManualEntryGrid })));
const SchemaMapper   = React.lazy(() => import('./components/SchemaMapper').then(m => ({ default: m.SchemaMapper })));


export default function App() {
  // Auth0 hook: gives us login state plus a function to fetch a fresh access token.
  const { getAccessTokenSilently, isAuthenticated, logout, isLoading: authLoading, loginWithRedirect } = useAuth0();

  // authFetch wraps the browser's fetch() so every API call in this file (session save/load, master
  // data lookups, AI fix calls, etc.) automatically gets an Auth0 bearer token attached. Use this instead
  // of plain fetch() anywhere the backend requires authentication.
  //
  // Refresh token rotation invalidates the previous token on every use. Without de-duplication, the
  // several authFetch calls that fire in parallel on load would race to use the same cached refresh
  // token, and all but the first would fail with "Missing Refresh Token".
  const tokenPromiseRef = useRef<Promise<string> | null>(null);

  const authFetch = useCallback(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!tokenPromiseRef.current) {
      tokenPromiseRef.current = getAccessTokenSilently().finally(() => {
        tokenPromiseRef.current = null;
      });
    }
    const token = await tokenPromiseRef.current;
    return fetch(input, {
      ...init,
      headers: { ...init?.headers, Authorization: `Bearer ${token}` },
    });
  }, [getAccessTokenSilently]);

  // --- State Management ---

  // Workflow control
  const [step, setStep] = useState<Step>('upload');
  const [dataType, setDataType] = useState<DataType>('inventory');

  // Manual entry: controls the "choose which columns to fill in" modal used by the manual entry grid (step === 'manual', ManualEntryGrid component further below)
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [pickerSelectedKeys, setPickerSelectedKeys] = useState<Set<string>>(new Set());

  // Column swap: tracks a two-click "pick source column, then pick target column" flow used by handleSwapColumns() below, in the review step's table header
  const [swapSourceKey, setSwapSourceKey] = useState<string | null>(null);
  const [swapPickingTarget, setSwapPickingTarget] = useState(false);

  // Corrections upload
  const correctionsInputRef = useRef<HTMLInputElement>(null);
  // Tracks the most-recently-started processData call. Only the latest call may commit its result
  // to processedData state — older in-flight calls discard their result on return. This prevents
  // a slow earlier call (chunked async) from overwriting a faster newer call's correct output.
  const processDataLatestId = useRef(0);
  
  // Data storage
  const [rawData, setRawData] = useState<any[]>([]); // Current working copy of raw data
  const [history, setHistory] = useState<any[][]>([]); // Undo history stack
  const [originalRawData, setOriginalRawData] = useState<any[]>([]); // Immutable copy of original upload
  const [headers, setHeaders] = useState<string[]>([]); // CSV/Excel headers
  const [fileName, setFileName] = useState<string>('');
  
  // Processing state
  const [mapping, setMapping] = useState<Record<string, string>>({}); // Map: Schema Field -> CSV Header
  const [processedData, setProcessedData] = useState<ProcessedRow[]>([]); // Validated and normalized data
  const greenCount = useMemo(() => processedData.filter(r => r.status === 'green').length, [processedData]);
  const redCount = useMemo(() => processedData.filter(r => r.status === 'red').length, [processedData]);
  const allGreen = useMemo(() => processedData.length > 0 && processedData.every(r => r.status === 'green'), [processedData]);

  // UI state
  const [showOnlyErrors, setShowOnlyErrors] = useState(false);
  const [showOnlyCorrect, setShowOnlyCorrect] = useState(false);
  // Pagination for the review table — without this, a large file renders every row as real DOM at
  // once (confirmed to bloat to 100k+ DOM nodes for a 5,000-row file), which is what made scrolling/
  // editing sluggish even after the processData chunking fix stopped the upload itself from freezing.
  const [reviewPage, setReviewPage] = useState(1);
  const [reviewPageSize, setReviewPageSize] = useState(100);
  const [editingRowId, setEditingRowId] = useState<number | null>(null);
  const [editingCell, setEditingCell] = useState<{ rowId: number, fieldKey: string } | null>(null);
  const [editStartingValue, setEditStartingValue] = useState<string | null>(null);

  const startEditingCell = (rowId: number, fieldKey: string) => {
    const row = processedData.find(r => r.id === rowId);
    const value = row ? row[fieldKey] : null;
    setEditStartingValue(value === null || value === undefined ? '' : String(value));
    setEditingCell({ rowId, fieldKey });
    // After React renders the editor, scroll it into view (covers both vertical and horizontal scroll)
    requestAnimationFrame(() => {
      const cell = document.querySelector(`[data-cell="${rowId}-${fieldKey}"]`);
      cell?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    });
  };
  const [comparingDuplicate, setComparingDuplicate] = useState<{ row1: number, row2: number } | null>(null);
  const [reviewQueueType, setReviewQueueType] = useState<'duplicate' | 'price' | null>(null);
  const [pendingQueueAdvance, setPendingQueueAdvance] = useState(false);
  const [isRulesModalOpen, setIsRulesModalOpen] = useState(false);
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  // Drives the "Validating your file..." progress overlay while processData() chunks through a large file.
  const [isValidating, setIsValidating] = useState(false);
  const [validationProgress, setValidationProgress] = useState({ done: 0, total: 0 });
  const [isAiReviewModalOpen, setIsAiReviewModalOpen] = useState(false);
  const [pendingAiChanges, setPendingAiChanges] = useState<any[]>([]);
  const [aiChangesSummary, setAiChangesSummary] = useState<any[]>([]);
  
  // Session persistence
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  
  // Edit tracking
  const [autoFixedMap, setAutoFixedMap] = useState<Record<number, string[]>>({}); // Track AI fixes
  const [calculationLogsMap, setCalculationLogsMap] = useState<Record<number, Record<string, string>>>({}); // Track AI calculation explanations
  const [manualEditsMap, setManualEditsMap] = useState<Record<number, string[]>>({}); // Track user edits
  const [ignoredDuplicates, setIgnoredDuplicates] = useState<Set<number>>(new Set()); // Track dismissed duplicates
  const [ignoredPriceWarnings, setIgnoredPriceWarnings] = useState<Set<number>>(new Set()); // Track dismissed price warnings

  // Master Data
  const [masterCellars, setMasterCellars] = useState<string[]>([]);
  const [masterClients, setMasterClients] = useState<string[]>([]);
  const [showAddLocationModal, setShowAddLocationModal] = useState(false);

  // Runs once on mount (authFetch identity only changes if the Auth0 token getter changes): loads reference/master
  // data (known cellar names, known client names, region reference data) used for autocomplete and validation
  // throughout the review step, plus the saved-sessions list (loadSessions, defined further below).
  useEffect(() => {
    // Wait for a real, completed Auth0 login before calling authFetch — otherwise this fires
    // immediately on mount (authFetch's identity doesn't change) before the redirect-based
    // login + MFA flow has finished, fails once, and — since nothing re-triggers it — never retries.
    if (!isAuthenticated) return;
    authFetch('/api/master/cellars')
      .then(r => r.json())
      .then(data => setMasterCellars(data))
      .catch(e => console.error("Failed to load master cellars", e));
    authFetch('/api/master/clients')
      .then(r => r.json())
      .then(data => setMasterClients(data))
      .catch(e => console.error("Failed to load master clients", e));
    authFetch('/api/master/regions')
      .then(r => r.json())
      .then(data => setRegionRefData(data))
      .catch(e => console.error("Failed to load regions", e));
    loadSessions();
  }, [authFetch, isAuthenticated]);

  // Runs whenever `step` changes: whenever the user lands back on the upload screen, refresh the
  // saved-sessions list so the "resume a session" list (rendered in the upload step JSX below) is current.
  useEffect(() => {
    if (step === 'upload') {
      loadSessions();
      // If we are back at home, we keep currentSessionId so the user can easily jump back
      // but we don't clear it unless it's a "Start New" action.
    }
  }, [step]);

  // Auto-sync session state: whenever the session id or any of the tracked wizard state below changes
  // (and we're past the upload step), debounce 2s then PATCH the current progress to the backend so the
  // user can resume later via handleLoadSession(). This is what makes "Save & resume" work automatically.
  useEffect(() => {
    if (currentSessionId && step !== 'upload') {
      const updateSession = async () => {
        try {
          await authFetch(`/api/sessions/${currentSessionId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fields: {
                fileName,
                dataType,
                mapping,
                currentStep: step,
                autoFixedMap,
                manualEditsMap,
                calculationLogsMap,
                ignoredDuplicates: Array.from(ignoredDuplicates),
                ignoredPriceWarnings: Array.from(ignoredPriceWarnings)
              }
            })
          });
        } catch (err) {
          console.error('Failed to sync session state', err);
        }
      };
      
      const timer = setTimeout(updateSession, 2000); // Debounce
      return () => clearTimeout(timer);
    }
  }, [currentSessionId, step, mapping, fileName, dataType, autoFixedMap, manualEditsMap, calculationLogsMap, ignoredDuplicates, ignoredPriceWarnings]);

  // Fetches the list of saved sessions from the backend for the "resume a session" list in the upload step.
  const loadSessions = async () => {
    setIsLoadingSessions(true);
    try {
      const response = await authFetch('/api/sessions');
      if (response.ok) {
        const data = await response.json();
        setSessions(data);
      }
    } catch (error) {
      console.error("Failed to load sessions", error);
    } finally {
      setIsLoadingSessions(false);
    }
  };

  // Resumes a previously saved session: fetches its stored rows/mapping/step from the backend and
  // restores all the local state (autoFixedMap, manualEditsMap, ignored warnings, etc.) so the user
  // lands back exactly where they left off.
  const handleLoadSession = async (sessionId: number) => {
    setIsAiProcessing(true); // Re-use for loading state
    setReviewPage(1);
    try {
      const response = await authFetch(`/api/sessions/${sessionId}`);
      if (response.ok) {
        const data = await response.json();
        
        // Handle database column naming (fields_json vs fields)
        const rawFields = data.fields_json || data.fields || {};
        const fields = typeof rawFields === 'string' ? JSON.parse(rawFields) : rawFields;
        
        const rawMapping = data.mapping_json || data.mapping || {};
        const map = typeof rawMapping === 'string' ? JSON.parse(rawMapping) : rawMapping;

        const rows = data.rows || [];
        const dt = (fields.dataType as DataType) || 'inventory';
        // 'lwin-check' step no longer exists — redirect old sessions to mapping
        const rawStep = fields.currentStep === 'lwin-check' ? 'map' : fields.currentStep;
        const st = (rawStep as Step) || 'review';


        // Restore all maps
        setAutoFixedMap(fields.autoFixedMap || {});
        setManualEditsMap(fields.manualEditsMap || {});
        setCalculationLogsMap(fields.calculationLogsMap || {});
        setIgnoredDuplicates(new Set(fields.ignoredDuplicates || []));
        setIgnoredPriceWarnings(new Set(fields.ignoredPriceWarnings || []));

        // Set ID first to silence auto-sync loop if needed (though it debounces)
        setCurrentSessionId(data.id);
        
        setFileName(fields.fileName || 'Loaded Session');
        setDataType(dt);
        
        // Correctly reconstruct rawData from rows to ensure no original headers are lost.
        const reconstructedRaw = rows.map((r: any, idx: number) => {
          const { id, db_id, updated_at, status, errors, fieldErrors, raw, manualEdits, isDuplicate, isPriceOutlier, calculation_logs, ...rest } = r;
          
          // Merge schema fields (rest) back into the original raw object if it exists.
          // This ensures that even if some fields were updated but not the original headers, we have a complete view.
          const merged = { ...(raw || {}), ...rest, id: idx };
          return merged;
        });
        
        setRawData(reconstructedRaw);
        setOriginalRawData(JSON.parse(JSON.stringify(reconstructedRaw)));

        // Reconstruct headers
        if (reconstructedRaw.length > 0) {
          const firstRow = reconstructedRaw[0];
          const systemKeys = ['id', 'db_id', 'updated_at', 'status', 'errors', 'fieldErrors', 'raw', 'manualEdits', 'isDuplicate', 'isPriceOutlier', 'calculation_logs'];
          const filteredKeys = Object.keys(firstRow).filter(k => !systemKeys.includes(k));
          setHeaders(filteredKeys);
        }

        setMapping(map);
        
        // If we were already in review, trust the DB rows directly as processedData
        // This ensures modifications (like calculated values) are preserved exactly
        if (st === 'review' && rows.length > 0) {
          // Normalize rows to ensure they have expected arrays
          const normalizedRows = rows.map((r: any) => ({
            ...r,
            errors: r.errors || [],
            fieldErrors: r.fieldErrors || [],
            status: r.status || 'green'
          }));
          setProcessedData(normalizedRows);
        } else if (Object.keys(map).length > 0) {
          await processData(
            reconstructedRaw,
            map,
            regionRefData,
            new Set(fields.ignoredDuplicates || []),
            fields.autoFixedMap || {},
            fields.manualEditsMap || {},
            new Set(fields.ignoredPriceWarnings || []),
            fields.calculationLogsMap || {}
          );
        } else {
          setProcessedData(rows);
        }
        
        // Finalize step
        setStep(st);
        
        // Reload list to reflect active state
        loadSessions();
      } else {
        throw new Error('Failed to fetch session details');
      }
    } catch (error) {
      console.error("[Resume] Failed to load session details", error);
      setValidationError("Failed to load session. It might have been deleted.");
    } finally {
      setIsAiProcessing(false);
    }
  };

  // Permanently deletes a saved session on the backend (after a confirm dialog) and refreshes the list.
  const handleDeleteSession = async (sessionId: number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    
    const confirmed = window.confirm("Are you sure you want to PERMANENTLY delete this session and all its data? This cannot be undone.");
    if (!confirmed) return;
    
    try {
      const response = await authFetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
      if (response.ok) {
        loadSessions();
        if (currentSessionId === sessionId) {
          goHome();
        }
      } else {
        const err = await response.json();
        alert(`Failed to delete: ${err.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error("Failed to delete session", error);
    }
  };

  // After a successful import, remembers new cellar names / client account codes so they appear as
  // known values (autocomplete + duplicate detection) next time. Updates masterCellars/masterClients state
  // (loaded on mount above) and persists them to the backend.
  const handleSaveMasterData = () => {
    if (dataType === 'cellars') {
      const validCellarNames = processedData
        .filter(r => r.status !== 'red')
        .map(r => String(r.cellar_name || '').trim())
        .filter(name => name !== '');
      const newMasterList = Array.from(new Set([...masterCellars, ...validCellarNames]));
      setMasterCellars(newMasterList);
      authFetch('/api/master/cellars', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names: newMasterList }),
      }).catch(e => console.error("Failed to save master cellars", e));
    } else if (dataType === 'contacts' || dataType === 'private_clients' || dataType === 'trade_clients' || dataType === 'suppliers') {
      const validAccountCodes = processedData
        .filter(r => r.status !== 'red')
        .map(r => String(r.account_code || '').trim())
        .filter(code => code !== '');
      const newMasterList = Array.from(new Set([...masterClients, ...validAccountCodes]));
      setMasterClients(newMasterList);
      authFetch('/api/master/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codes: newMasterList }),
      }).catch(e => console.error("Failed to save master clients", e));
    }
  };

  // Wipes the stored master cellar/client list, both locally and on the backend (used from the admin panel).
  const handleClearMasterData = (type: string) => {
    if (type === 'cellars') {
      setMasterCellars([]);
      authFetch('/api/master/cellars', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ names: [] }) })
        .catch(e => console.error("Failed to clear master cellars", e));
    } else if (type === 'contacts' || type === 'private_clients' || type === 'trade_clients' || type === 'suppliers') {
      setMasterClients([]);
      authFetch('/api/master/clients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codes: [] }) })
        .catch(e => console.error("Failed to clear master clients", e));
    }
  };
  
  // Adds a brand-new cellar name from the AddLocationModal (rendered near the bottom of this file) to the master list.
  const handleAddLocation = (data: Record<string, string>) => {
    const cellarName = data.cellar_name?.trim();
    if (!cellarName) return;
    const newList = Array.from(new Set([...masterCellars, cellarName]));
    setMasterCellars(newList);
    fetch('/api/master/cellars', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names: newList }),
    }).catch(e => console.error('Failed to save master cellars', e));
    setShowAddLocationModal(false);
  };

  // Inventory specific state
  const [regionRefData, setRegionRefData] = useState<any[]>([]);

  const [hasAutoFixed, setHasAutoFixed] = useState(false);
  const [showOnlyEdited, setShowOnlyEdited] = useState(false);
  const [pendingBulkAction, setPendingBulkAction] = useState<{
    field: string;
    oldValue: string;
    newValue: string;
    rowIds: number[];
  } | null>(null);

  /**
   * Applies the proposed bulk fix to all matching rows.
   * Triggered from the review step's "apply to all similar rows" prompt (pendingBulkAction state above);
   * re-runs processData() afterward so validation/status reflect the change, same as any other edit.
   */
  const applyBulkFix = async () => {
    if (!pendingBulkAction) return;

    // Save current state to history
    setHistory(prev => [...prev, JSON.parse(JSON.stringify(rawData))].slice(-20));

    const newData = [...rawData];
    const { field, newValue, rowIds } = pendingBulkAction;
    const targetKey = mapping[field] || field;

    rowIds.forEach(id => {
      const rawRow = { ...newData[id] };
      rawRow[targetKey] = newValue;
      // Mirror handleRowUpdate: also write to the schema field key so getValue Priority 1 picks
      // it up (critical when targetKey is a __const__ sentinel and Priority 3 ignores rawData).
      if (targetKey !== field) rawRow[field] = newValue;
      newData[id] = rawRow;
    });

    // Update manual edits map
    const newManualEditsMap = { ...manualEditsMap };
    rowIds.forEach(id => {
      newManualEditsMap[id] = Array.from(new Set([...(newManualEditsMap[id] || []), field]));
    });
    setManualEditsMap(newManualEditsMap);

    setRawData(newData);
    setPendingBulkAction(null);
    
    // Re-validate
    const processed = await processData(newData, mapping, regionRefData, ignoredDuplicates, autoFixedMap, newManualEditsMap, ignoredPriceWarnings, calculationLogsMap);

    if (currentSessionId) {
      handleBulkUpdateRows(processed.filter(r => rowIds.includes(r.id)));
    }
  };

  // Completed Tasks state — org-scoped, loaded synchronously from localStorage cache.
  // Tracks, per data type, the last import marked "done" (used to show a "completed" badge/summary
  // on the upload step and let the user re-download past exports without redoing the wizard).
  const [orgId, setOrgId] = useState<number>(() =>
    parseInt(localStorage.getItem('_vd_org_id') ?? '1', 10)
  );
  const completedStorageKey = `completed_tasks_org_${orgId}`;
  const [completedTasks, setCompletedTasks] = useState<Record<string, { data?: any[], fileName: string, completedAt: string }>>(() => {
    const key = `completed_tasks_org_${parseInt(localStorage.getItem('_vd_org_id') ?? '1', 10)}`;
    let raw = localStorage.getItem(key);
    if (!raw) {
      // One-time migration from old unscoped key
      const legacy = localStorage.getItem('completed_tasks');
      if (legacy) {
        localStorage.setItem(key, legacy);
        localStorage.removeItem('completed_tasks');
        raw = legacy;
      }
    }
    try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
  });
  const [openCompletedDropdown, setOpenCompletedDropdown] = useState<DataType | null>(null);

  const [showAdmin, setShowAdmin] = useState(false); // toggles rendering the AdminPanel component instead of the wizard

  // Logged-in user identity (from the backend, not just Auth0) — org id, display name, access level.
  // user_access drives whether the "Admin" entry point is shown in the header UI further below.
  const [currentUser, setCurrentUser] = useState<{
    user_id: number;
    display_name: string;
    forename: string;
    organisation_id: number;
    organisation_name: string;
    user_access: string;
  } | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  // Runs once a real Auth0 login has completed: fetches identity from backend (/api/me) — validates
  // org + user, populates currentUser (used for admin access checks), and re-keys the completedTasks
  // localStorage cache if the resolved organisation id differs from what was cached.
  // See the isAuthenticated gate note on the master-data effect above — same reasoning applies here.
  useEffect(() => {
    if (!isAuthenticated) return;
    authFetch('/api/me')
      .then(r => r.json().then(d => ({ ok: r.ok, data: d })))
      .then(({ ok, data }) => {
        if (!ok) {
          setAuthError(data.detail ?? 'Unknown authentication error.');
          return;
        }
        const id = data.organisation_id as number;
        localStorage.setItem('_vd_org_id', String(id));
        setCurrentUser(data);
        if (id !== orgId) {
          setOrgId(id);
          const key = `completed_tasks_org_${id}`;
          const raw = localStorage.getItem(key);
          try { setCompletedTasks(raw ? JSON.parse(raw) : {}); } catch { setCompletedTasks({}); }
        }
      })
      .catch(err => console.error('[/api/me]', err));
  }, [authFetch, isAuthenticated]);

  // Runs whenever the "completed tasks" dropdown opens/closes: closes it on any click outside its button.
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (openCompletedDropdown) {
        const target = event.target as HTMLElement;
        if (!target.closest('.group\\/btn')) {
          setOpenCompletedDropdown(null);
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openCompletedDropdown]);

  // Marks the current import as finished: only allowed once every row is green (no errors), saves
  // master data (cellars/clients) and records the result in completedTasks (persisted to localStorage below).
  const handleMarkAsComplete = async () => {
    if (!allGreen) return;

    // Add to master list first
    handleSaveMasterData();

    const newCompleted = {
      ...completedTasks,
      [dataType]: {
        data: processedData,
        fileName: fileName,
        completedAt: new Date().toISOString()
      }
    };

    setCompletedTasks(newCompleted);
    // Only persist metadata (no row data) — serialising thousands of rows exceeds the localStorage
    // quota and blocks the UI. Row data stays in in-memory state for the current session.
    try {
      const metaOnly: Record<string, { fileName: string; completedAt: string }> = {};
      Object.keys(newCompleted).forEach(t => {
        metaOnly[t] = { fileName: newCompleted[t].fileName, completedAt: newCompleted[t].completedAt };
      });
      localStorage.setItem(completedStorageKey, JSON.stringify(metaOnly));
    } catch { /* ignore */ }

    // Navigate immediately — don't block on the DB update
    setOpenCompletedDropdown(null);
    setStep('upload');
    setCurrentSessionId(null);

    // Update session status in DB (fire-and-forget)
    if (currentSessionId) {
      authFetch(`/api/sessions/${currentSessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' })
      }).then(() => loadSessions()).catch(error => {
        console.error("Failed to mark session as completed in DB", error);
      });
    }
  };

  // Removes a data type's "completed" badge/record from the completedTasks map and localStorage.
  const handleClearCompletedTask = (type: string) => {
    const newCompleted = { ...completedTasks };
    delete newCompleted[type];
    setCompletedTasks(newCompleted);
    try {
      const metaOnly: Record<string, { fileName: string; completedAt: string }> = {};
      Object.keys(newCompleted).forEach(t => {
        metaOnly[t] = { fileName: newCompleted[t].fileName, completedAt: newCompleted[t].completedAt };
      });
      localStorage.setItem(completedStorageKey, JSON.stringify(metaOnly));
    } catch { /* ignore */ }
    setOpenCompletedDropdown(null);
  };

  // Un-marks a completed session as "in_progress" on the backend, clears its completed badge, then
  // calls handleLoadSession() above to bring the wizard back to where that session left off.
  const handleReopenSession = async (sessionId: number, type: DataType) => {
    try {
      await authFetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'in_progress' })
      });
    } catch (e) {
      console.error('[Reopen] Failed to update session status', e);
    }
    const newCompleted = { ...completedTasks };
    delete newCompleted[type];
    setCompletedTasks(newCompleted);
    try {
      const metaOnly: Record<string, { fileName: string; completedAt: string }> = {};
      Object.keys(newCompleted).forEach(t => {
        metaOnly[t] = { fileName: newCompleted[t].fileName, completedAt: newCompleted[t].completedAt };
      });
      localStorage.setItem(completedStorageKey, JSON.stringify(metaOnly));
    } catch { /* ignore */ }
    setOpenCompletedDropdown(null);
    await handleLoadSession(sessionId);
  };

  // Bundles every completed data type's rows into one CSV-per-type, zipped, and downloads it (uses SCHEMAS to build each CSV's columns).
  // Shared CSV-building helper used by every export function below. Escapes each field's value
  // (handles currency objects, quotes/commas/newlines) and joins into a header row + data rows.
  // extraColumns lets a caller append already-formatted columns after the schema's own fields
  // (used by handleExportErrors for its "Errors to Fix" and "__row_id__" columns).

  const handleDownloadAllCompleted = async () => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();

    Object.keys(completedTasks).forEach((type) => {
      const task = completedTasks[type];
      if (!task.data?.length) return; // data only available in-session; skip if not present
      const schema = SCHEMAS[type as DataType];
      const extras = type === 'inventory' ? [{ label: 'customer code', value: () => 'HUB' }] : undefined;
      const csv = rowsToCsv(schema, task.data, extras);
      const safeName = `${type}_${(task.fileName.split('.')[0] || type)}.csv`;
      zip.file(safeName, csv);
    });

    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, 'vinoclean_completed_exports.zip');
  };

  // Downloads a single completed data type's rows as one CSV (single-type version of handleDownloadAllCompleted above).
  const handleExportCompleted = (type: string) => {
    const task = completedTasks[type];
    if (!task) return;

    if (!task.data?.length) { alert('Export data is only available within the current session. Please re-import the file to re-export.'); return; }
    const currentSchema = SCHEMAS[type as DataType];
    const extras = type === 'inventory' ? [{ label: 'customer code', value: () => 'HUB' }] : undefined;
    downloadCsv(rowsToCsv(currentSchema, task.data, extras), `completed_${task.fileName.split('.')[0] || 'data'}.csv`);
    setOpenCompletedDropdown(null);
  };

  // --- Handlers ---
  // Everything below is the wizard's business logic: export, corrections upload, file parsing/validation
  // (processData), column mapping, manual entry, and the AI-fix flow. The JSX render tree near the end of
  // this file wires its buttons/inputs up to these functions.

  /**
   * Dynamically determines the active schema based on user input.
   * For 'inventory', it adjusts required fields based on whether the user has LWINs.
   * Used by the mapping step (SchemaMapper), export, and error-export/correction functions below,
   * instead of reading SCHEMAS[dataType] directly, so lwin7's required-ness stays consistent everywhere.
   */
  const getCurrentSchema = () => {
    const base = SCHEMAS[dataType];
    if (dataType !== 'inventory' && dataType !== 'client_reserves' && dataType !== 'sales_orders' && dataType !== 'purchase_orders') return base;
    // LWIN and descriptive fields are validated per-row in processData.
    // The mapper only needs to know which columns exist — lwin7 is optional here.
    return {
      ...base,
      fields: base.fields.map(f => f.key === 'lwin7' ? { ...f, required: false } : f)
    };
  };

  /**
   * Exports the cleaned data to a CSV file.
   * Only exports rows that are NOT red (invalid).
   */
  const handleExport = () => {
    if (processedData.length === 0) return;

    const currentSchema = getCurrentSchema();
    const rows = processedData.filter(r => r.status !== 'red'); // Only export valid or reviewable rows
    const customExtras = Object.keys(mapping)
      .filter(k => k.startsWith('__custom_col__'))
      .map(k => ({ label: k.slice(14), value: (row: any) => { const v = String(row[k] ?? ''); return (v.includes(',') || v.includes('"') || v.includes('\n')) ? `"${v.replace(/"/g, '""')}"` : v; } }));
    downloadCsv(rowsToCsv(currentSchema, rows, customExtras), `clean_${fileName.split('.')[0] || 'data'}.csv`);

    // Mark session as completed
    if (currentSessionId) {
      authFetch(`/api/sessions/${currentSessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' })
      }).then(() => loadSessions()).catch(err => console.error("Failed to mark session as completed", err));
    }
  };

  // Exports only the invalid ("red") rows to CSV, with an extra "Errors to Fix" column and a hidden
  // __row_id__ column. This file is meant to be edited outside the app and re-imported via
  // handleUploadCorrections() below, which matches rows back up using that __row_id__ column.
  const handleExportErrors = () => {
    const errorRows = processedData.filter(r => r.status === 'red');
    if (errorRows.length === 0) return;

    const currentSchema = getCurrentSchema();
    const csvContent = rowsToCsv(currentSchema, errorRows, [
      { label: 'Errors to Fix', value: row => `"${(row.errors?.join('; ') || '').replace(/"/g, '""')}"` },
      { label: '__row_id__', value: row => String(row.id) },
    ]);
    downloadCsv(csvContent, `errors_${fileName.split('.')[0] || 'data'}.csv`);
  };

  const handleExportCorrect = () => {
    const correctRows = processedData.filter(r => r.status === 'green');
    if (correctRows.length === 0) return;
    const currentSchema = getCurrentSchema();
    const customExtras = Object.keys(mapping)
      .filter(k => k.startsWith('__custom_col__'))
      .map(k => ({ label: k.slice(14), value: (row: any) => { const v = String(row[k] ?? ''); return (v.includes(',') || v.includes('"') || v.includes('\n')) ? `"${v.replace(/"/g, '""')}"` : v; } }));
    downloadCsv(rowsToCsv(currentSchema, correctRows, customExtras), `correct_${fileName.split('.')[0] || 'data'}.csv`);
  };

  // Minimal CSV line parser (handles quoted fields and escaped quotes) used by handleUploadCorrections() below.
  const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current);
    return result;
  };

  // Re-imports a corrected CSV (the one produced by handleExportErrors above, or a similar hand-edited
  // file). Rows are matched back to the original rawData by the hidden __row_id__ column when present
  // (so edits land on the exact same row even if it was re-ordered); each corrected column is looked up
  // by its schema label and mapped back to its internal field key before being merged into rawData.
  const handleUploadCorrections = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split('\n').map(l => l.trimEnd()).filter(l => l.trim());
      if (lines.length < 2) return;

      const headers = parseCSVLine(lines[0]);
      const rowIdIdx = headers.findIndex(h => h === '__row_id__');
      const currentSchema = getCurrentSchema();
      const labelToKey: Record<string, string> = {};
      currentSchema.fields.forEach(f => { labelToKey[f.label] = f.key; });

      const correctionRows = lines.slice(1).map(line => {
        const values = parseCSVLine(line);
        const row: Record<string, any> = {};
        headers.forEach((h, i) => {
          if (h === 'Errors to Fix') return;
          if (h === '__row_id__') { row.__row_id__ = parseInt(values[i], 10); return; }
          const key = labelToKey[h];
          if (key) row[key] = values[i] ?? '';
        });
        return row;
      });

      setHistory(prev => [...prev, JSON.parse(JSON.stringify(rawData))].slice(-20));

      let newRawData = rawData.map(r => ({ ...r }));

      if (rowIdIdx !== -1) {
        correctionRows.forEach(corrRow => {
          const id = corrRow.__row_id__;
          const idx = newRawData.findIndex(r => r.id === id);
          if (idx === -1) return;
          const updatedRow = { ...newRawData[idx] };
          Object.entries(corrRow).forEach(([key, val]) => {
            if (key === '__row_id__') return;
            updatedRow[key] = val;
            const mappedHeader = mapping[key];
            if (mappedHeader) updatedRow[mappedHeader] = val;
          });
          newRawData[idx] = updatedRow;
        });
      } else {
        // Fallback: replace red rows by position
        const redIds = processedData.filter(r => r.status === 'red').map(r => r.id);
        correctionRows.forEach((corrRow, i) => {
          const id = redIds[i];
          if (id === undefined) return;
          const idx = newRawData.findIndex(r => r.id === id);
          if (idx === -1) return;
          const updatedRow = { ...newRawData[idx] };
          Object.entries(corrRow).forEach(([key, val]) => {
            updatedRow[key] = val;
            const mappedHeader = mapping[key];
            if (mappedHeader) updatedRow[mappedHeader] = val;
          });
          newRawData[idx] = updatedRow;
        });
      }

      setRawData(newRawData);
      await processData(newRawData, mapping);
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  /**
   * Handles the initial file upload (called by FileUploader in the upload-step JSX below once it has
   * parsed the chosen file into rows). Validates prerequisite master data exists, stores the raw rows,
   * runs an initial (unmapped) processData() pass, creates a backend session, and advances to the map step.
   * Note: despite the old comment below, there's no separate LWIN-check step anymore — everything goes to 'map'.
   */
  const handleUpload = async (data: any[], fields: string[], name: string) => {
    setValidationError(null);
    setCurrentSessionId(null);
    setReviewPage(1);

    if ((dataType === 'inventory' || dataType === 'client_reserves' || dataType === 'sales_orders' || dataType === 'purchase_orders') && masterCellars.length === 0) {
      setValidationError("Please load your Cellars first. This import type requires a Master Cellar List for validation.");
      return;
    }

    if ((dataType === 'client_reserves' || dataType === 'sales_orders') && masterClients.length === 0) {
      setValidationError("Please load Private Clients, Trade Clients, or Suppliers first. This import type requires existing Account Codes for validation.");
      return;
    }

    const dataWithIds = data.map((r, i) => ({ ...r, id: i }));
    setRawData(dataWithIds);
    setOriginalRawData(JSON.parse(JSON.stringify(dataWithIds))); // Deep copy for reset functionality
    setHeaders(fields);
    setFileName(name);
    setManualEditsMap({});
    setIgnoredDuplicates(new Set());
    
    // Always go to mapping first — LWIN presence is detected per-row during processing
    const initialStep: Step = 'map';

    setIsValidating(true);
    const initialProcessed = await processData(dataWithIds, {}, regionRefData, undefined, undefined, undefined, undefined, undefined,
      (done, total) => setValidationProgress({ done, total }));
    setIsValidating(false);
    setProcessedData(initialProcessed);
    
    // Create initial session in DB
    try {
      authFetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionType: `${dataType}: ${name}`,
          rows: dataWithIds,
          fields: { mapping: {}, fileName: name, dataType: dataType, currentStep: initialStep }
        })
      }).then(res => res.json()).then(result => {
        if (result.id) {
          setCurrentSessionId(result.id);
          loadSessions();
        }
      });
    } catch (error) {
      console.error("Failed to create initial session", error);
    }
    
    setStep(initialStep);
  };

  // Swaps the data behind two schema columns. Triggered by clicking a target column after a source
  // column was picked (swapSourceKey/swapPickingTarget state above, set from the review table header).
  // Two cases: for a file upload, columns still point at original CSV headers via `mapping`, so we just
  // swap the mapping entries; for manual entry there's no mapping (values live directly under the schema
  // keys in rawData), so we swap the values in each row instead. Either way processData() re-runs after.
  const handleSwapColumns = async (targetKey: string) => {
    if (!swapSourceKey || swapSourceKey === targetKey) {
      setSwapSourceKey(null);
      setSwapPickingTarget(false);
      return;
    }
    setHistory(prev => [...prev, JSON.parse(JSON.stringify(rawData))].slice(-20));

    let newMapping = { ...mapping };
    let newRawData = rawData;

    if (Object.keys(mapping).length > 0) {
      // File upload: swap the mapping so each schema key reads from the other's original column
      const temp = newMapping[swapSourceKey];
      newMapping[swapSourceKey] = newMapping[targetKey];
      newMapping[targetKey] = temp;
      setMapping(newMapping);
    } else {
      // Manual entry: values are stored directly under schema keys, swap them
      newRawData = rawData.map(row => {
        const r = { ...row };
        const temp = r[swapSourceKey];
        r[swapSourceKey] = r[targetKey];
        r[targetKey] = temp;
        return r;
      });
      setRawData(newRawData);
    }

    await processData(newRawData, newMapping);
    setSwapSourceKey(null);
    setSwapPickingTarget(false);
  };

  // Opens the column picker modal (showColumnPicker state above) before manual entry starts, pre-selecting
  // required fields plus whichever optional columns the user picked last time (remembered in localStorage per data type).
  const handleOpenManualEntry = () => {
    const schema = getCurrentSchema();
    const requiredKeys = new Set(schema.fields.filter(f => f.required).map(f => f.key));
    const colPrefKey = `vd_cols_${dataType}`;
    let initial: Set<string>;
    try {
      const saved = localStorage.getItem(colPrefKey);
      if (saved) {
        const savedOptional = new Set<string>(JSON.parse(saved));
        initial = new Set([...Array.from(requiredKeys), ...Array.from(savedOptional)]);
      } else {
        initial = new Set(schema.fields.map(f => f.key));
      }
    } catch {
      initial = new Set(schema.fields.map(f => f.key));
    }
    setPickerSelectedKeys(initial);
    setShowColumnPicker(true);
  };

  // Confirms the column picker selection, remembers the optional columns chosen for next time, and switches to step === 'manual' (ManualEntryGrid).
  const handleStartManualEntry = () => {
    const schema = getCurrentSchema();
    const requiredKeys = new Set(schema.fields.filter(f => f.required).map(f => f.key));
    const optionalSelected = new Set(Array.from(pickerSelectedKeys).filter(k => !requiredKeys.has(k)));
    try {
      localStorage.setItem(`vd_cols_${dataType}`, JSON.stringify(Array.from(optionalSelected)));
    } catch {}
    setShowColumnPicker(false);
    setStep('manual');
  };

  // Called by ManualEntryGrid when the user finishes typing rows by hand: stores them as rawData with an
  // empty mapping (manual rows already use schema keys directly), runs processData(), creates a backend
  // session, and jumps straight to the review step.
  const handleManualSubmit = async (rows: Record<string, string>[]) => {
    setReviewPage(1);
    const dataWithIds = rows.map((r, i) => ({ ...r, id: i }));
    setRawData(dataWithIds);
    setOriginalRawData(JSON.parse(JSON.stringify(dataWithIds)));
    setHeaders(Array.from(pickerSelectedKeys));
    const name = `Manual Entry — ${SCHEMAS[dataType].label}`;
    setFileName(name);
    setManualEditsMap({});
    setIgnoredDuplicates(new Set());
    setCurrentSessionId(null);
    setMapping({});

    setIsValidating(true);
    await processData(dataWithIds, {}, regionRefData, undefined, undefined, undefined, undefined, undefined,
      (done, total) => setValidationProgress({ done, total }));
    setIsValidating(false);

    authFetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionType: `${dataType}: Manual Entry`,
        rows: dataWithIds,
        fields: { mapping: {}, fileName: name, dataType, currentStep: 'review' }
      })
    }).then(res => res.json()).then(result => {
      if (result.id) {
        setCurrentSessionId(result.id);
        loadSessions();
      }
    }).catch(e => console.error('Failed to create manual entry session', e));

    setStep('review');
  };

  // Creates a brand-new backend session record for the current processed data + mapping (used the first
  // time a session is persisted; later updates go through the PATCH calls in handleMappingComplete/the
  // auto-sync useEffect above). Called from handleMappingComplete below when there's no currentSessionId yet.
  const handleSaveSession = async (processed: ProcessedRow[], currentMapping: Record<string, string>) => {
    try {
      // Prepare the payload to match server.ts expectations
      const fields = {
        fileName,
        dataType,
        mapping: currentMapping,
        currentStep: 'review',
        autoFixedMap,
        manualEditsMap,
        calculationLogsMap,
        ignoredDuplicates: Array.from(ignoredDuplicates),
        ignoredPriceWarnings: Array.from(ignoredPriceWarnings)
      };

      const response = await authFetch('/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionType: dataType,
          status: 'review',
          fields: fields,
          // We store the full processed object which includes the raw reference
          rows: processed
        }),
      });
      if (response.ok) {
        const result = await response.json();
        setCurrentSessionId(result.id);
        loadSessions();
      }
    } catch (error) {
      console.error('Failed to save session', error);
    }
  };

  // Triggered when the user finishes mapping columns (SchemaMapper's "Continue" in the map step JSX below).
  // Applies the mapping, decides whether enough fields are mapped to auto-calculate quantities/prices
  // (handleCalculationSmartFix below) or just runs a normal processData() pass, then saves/syncs the
  // session and the caller (map step JSX) advances `step` to 'review'.
  const handleMappingComplete = async (newMapping: Record<string, string>) => {
    setMapping(newMapping);
    setHasAutoFixed(false);
    
    // Check if we should auto-calculate anything
    const hasInventoryMappings = dataType === 'inventory' || dataType === 'client_reserves' || dataType === 'sales_orders' || dataType === 'purchase_orders';
    const canCalc = hasInventoryMappings && (
      (newMapping['case_size'] && newMapping['case_quantity']) || 
      (newMapping['total_quantity'] && newMapping['case_size']) ||
      ((newMapping['price'] || newMapping['exc_vat_case'] || newMapping['case_cost_price']) && (newMapping['total_quantity'] || (newMapping['case_size'] && newMapping['case_quantity'])))
    );
    
    let processed: ProcessedRow[] = [];
    setIsValidating(true);
    if (canCalc) {
      processed = await handleCalculationSmartFix(rawData, newMapping, true);
    } else {
      processed = await processData(
        rawData,
        newMapping,
        regionRefData,
        ignoredDuplicates,
        autoFixedMap,
        manualEditsMap,
        ignoredPriceWarnings,
        calculationLogsMap,
        (done, total) => setValidationProgress({ done, total })
      );
    }
    setIsValidating(false);

    if (!currentSessionId) {
      handleSaveSession(processed, newMapping);
    } else {
      // Sync to existing session
      try {
        await authFetch(`/api/sessions/${currentSessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: {
              fileName,
              dataType,
              mapping: newMapping,
              currentStep: 'review',
              autoFixedMap,
              manualEditsMap,
              calculationLogsMap,
              ignoredDuplicates: Array.from(ignoredDuplicates),
              ignoredPriceWarnings: Array.from(ignoredPriceWarnings)
            }
          })
        });
        handleBulkUpdateRows(processed, true);
      } catch (err) {
        console.error('Failed to sync mapping completion', err);
      }
    }
    
    setStep('review');
  };

  /**
   * Updates a single row or cell with manual edits.
   * - Saves state to history for Undo.
   * - Updates raw data.
   * - Tracks manual edits for highlighting.
   * - Re-runs validation.
   * Called both for single-cell inline edits (editedFieldKey set, from the review table) and full-row
   * edits (RowEditor modal, editedFieldKey omitted). Also feeds the "apply to similar rows" bulk-fix
   * suggestion (pendingBulkAction state / applyBulkFix() above) when a fix on one red row matches others.
   */
  const handleRowUpdate = async (updatedRow: any, editedFieldKey?: string) => {
    if (!updatedRow) return;

    // Save current state to history before changing
    setHistory(prev => [...prev, JSON.parse(JSON.stringify(rawData))].slice(-20));

    // Create a NEW array and CLONE the row we are about to modify to avoid reference issues
    const newData = [...rawData];
    
    if (updatedRow.id === undefined) {
      console.error('[UpdateRow] Row has no ID:', updatedRow);
      return;
    }

    // Find the row by ID. We must be robust here.
    let rowIndex = newData.findIndex(r => r.id === updatedRow.id);
    
    // Fallback: if we can't find by ID property, but the ID is within array bounds,
    // we assume the ID is the index (which is consistent with processData's behavior).
    if (rowIndex === -1 && typeof updatedRow.id === 'number' && updatedRow.id >= 0 && updatedRow.id < newData.length) {
      rowIndex = updatedRow.id;
    }

    if (rowIndex === -1) {
      console.error('[UpdateRow] Could not find row in rawData with id:', updatedRow.id);
      return;
    }
    
    const currentRow = newData[rowIndex];
    
    // We MUST preserve all fields in the original raw object. 
    // processData depends on these original headers.
    const rawRow = currentRow ? { ...currentRow } : { id: updatedRow.id };
    
    // Track manual edits (use new object for immediate re-validation)
    let nextManualEditsMap = { ...manualEditsMap };
    if (editedFieldKey) {
      // Single field update
      const targetKey = mapping[editedFieldKey] || editedFieldKey;
      rawRow[targetKey] = updatedRow[editedFieldKey];
      
      // Also update the key itself in rawRow to ensure immediate visibility if mapping fails
      if (targetKey !== editedFieldKey) {
        rawRow[editedFieldKey] = updatedRow[editedFieldKey];
      }
      
      nextManualEditsMap[updatedRow.id] = Array.from(new Set([...(nextManualEditsMap[updatedRow.id] || []), editedFieldKey]));
      setManualEditsMap(nextManualEditsMap);
    } else {
      // Full row update (from RowEditor)
      let rowEdits = nextManualEditsMap[updatedRow.id] || [];
      getCurrentSchema().fields.forEach(field => {
        const key = field.key;
        if (updatedRow[key] !== undefined && updatedRow[key] !== null) {
          const targetKey = mapping[key] || key;
          rawRow[targetKey] = updatedRow[key];
          // Always update local key too for safety
          if (targetKey !== key) {
            rawRow[key] = updatedRow[key];
          }
          rowEdits = Array.from(new Set([...rowEdits, key]));
        }
      });
      nextManualEditsMap[updatedRow.id] = rowEdits;
      setManualEditsMap(nextManualEditsMap);
    }
    
    newData[rowIndex] = rawRow;
    
    // If we're updating a row, we should probably re-evaluate its duplicate/price status
    const newIgnoredDups = new Set<number>(ignoredDuplicates);
    newIgnoredDups.delete(updatedRow.id);
    setIgnoredDuplicates(newIgnoredDups);

    const newIgnoredPrice = new Set<number>(ignoredPriceWarnings);
    newIgnoredPrice.delete(updatedRow.id);
    setIgnoredPriceWarnings(newIgnoredPrice);
    
    setRawData(newData);
    
    // --- Bulk Fix Detection ---
    if (editedFieldKey && editStartingValue !== null) {
      const oldVal = editStartingValue;
      const newVal = updatedRow[editedFieldKey];
      
      // We only suggest bulk fixes for specific fields
      const bulkFixableFields = ['cellar_name', 'account_code', 'producer', 'country', 'region', 'lwin7', 'sub_region', 'vintage', 'type', 'sub_type', 'currency', 'warehouse_location', 'tax_status', 'packaging_type'];
      
      if (oldVal && newVal && String(oldVal).trim() !== String(newVal).trim() && bulkFixableFields.includes(editedFieldKey)) {
        const otherRowsWithSameVal = processedData.filter(r => {
          if (r.id === updatedRow.id) return false;
          if (String(r[editedFieldKey] || '').trim() !== String(oldVal).trim()) return false;
          if (r.status !== 'red') return false;
          if (!(r.fieldErrors || []).includes(editedFieldKey)) return false;
          // For region/sub_region: scope to the same country — fixing "Emilia-Romagna wrong for France"
          // must not bulk-change rows where the same region is wrong for a different country (e.g. Spain).
          if (editedFieldKey === 'region' || editedFieldKey === 'sub_region') {
            const fixedCountry = String(updatedRow['country'] || '').trim().toLowerCase();
            const candidateCountry = String(r['country'] || '').trim().toLowerCase();
            if (fixedCountry !== candidateCountry) return false;
          }
          return true;
        });

        if (otherRowsWithSameVal.length >= 1) {
          setPendingBulkAction({
            field: editedFieldKey,
            oldValue: String(oldVal),
            newValue: String(newVal),
            rowIds: otherRowsWithSameVal.map(r => r.id)
          });
        }
      }
      setEditStartingValue(null);
    }
    
    // Check if the edited field should trigger a re-calculation
    const calcFields = ['case_size', 'case_quantity', 'total_quantity', 'case_cost_price', 'exc_vat_case', 'total'];
    let processed: ProcessedRow[] = [];
    
    // If we are editing a mapped field, we must re-process to catch side effects
    if (editedFieldKey && calcFields.includes(editedFieldKey)) {
      processed = await handleCalculationSmartFix(newData, mapping, true, nextManualEditsMap);
    } else {
      processed = await processData(newData, mapping, regionRefData, newIgnoredDups, autoFixedMap, nextManualEditsMap, newIgnoredPrice, calculationLogsMap);
    }

    setEditingRowId(null);

    // Persist to DB if session active
    if (currentSessionId) {
      const rowToSync = processed.find(r => r.id === updatedRow.id);
      if (rowToSync) {
        // Log what we are syncing
        
        authFetch(`/api/sessions/${currentSessionId}/rows/${updatedRow.id + 1}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: rowToSync
          })
        }).catch(err => console.error('Failed to persist row update', err));
      }
    }
  };

  // Dismisses a flagged duplicate row (adds it to ignoredDuplicates) and re-validates so it stops showing as a duplicate warning.
  const handleIgnoreDuplicate = async (id: number) => {
    const newIgnored = new Set<number>(ignoredDuplicates);
    newIgnored.add(id);
    setIgnoredDuplicates(newIgnored);
    // We use actual current state values instead of undefined/empty maps to ensure highlights persist
    await processData(
      rawData,
      mapping,
      regionRefData,
      newIgnored,
      autoFixedMap,
      manualEditsMap,
      ignoredPriceWarnings,
      calculationLogsMap
    );
  };

  // Dismisses a flagged price-outlier warning on a row, mirroring handleIgnoreDuplicate above.
  const handleIgnorePriceWarning = async (id: number) => {
    const newIgnored = new Set<number>(ignoredPriceWarnings);
    newIgnored.add(id);
    setIgnoredPriceWarnings(newIgnored);
    // We use actual current state values instead of undefined/empty maps to ensure highlights persist
    await processData(
      rawData,
      mapping,
      regionRefData,
      ignoredDuplicates,
      autoFixedMap,
      manualEditsMap,
      newIgnored,
      calculationLogsMap
    );
  };

  // Pops the last snapshot off the `history` stack (pushed by every edit/delete/swap above) and restores
  // it as rawData, then re-validates. Wired to Ctrl/Cmd+Z via the keydown listener useEffect just below.
  const handleUndo = async () => {
    if (history.length === 0) return;
    const previousState = history[history.length - 1];
    setHistory(prev => prev.slice(0, -1));
    setRawData(previousState);
    // We must pass all current maps to maintain highlights after undo
    await processData(
      previousState,
      mapping,
      regionRefData,
      ignoredDuplicates,
      autoFixedMap,
      manualEditsMap,
      ignoredPriceWarnings,
      calculationLogsMap
    );
  };

  // Runs when step/history/handleUndo change: registers a global Ctrl/Cmd+Z listener that calls handleUndo() above, only while on the review step and history isn't empty.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        if (step === 'review' && history.length > 0) {
          e.preventDefault();
          handleUndo();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [step, history, handleUndo]);

  /**
   * Deletes a row from the dataset.
   * - Updates history.
   * - Shifts indices in edit maps to keep them synchronized.
   */
  const handleDeleteRow = async (id: number) => {
    // Save current state to history before deleting
    setHistory(prev => [...prev, JSON.parse(JSON.stringify(rawData))].slice(-20));
    
    const newData = rawData.filter((_, idx) => idx !== id).map((r, i) => ({ ...r, id: i }));
    setRawData(newData);
    
    // Also need to update manualEditsMap and autoFixedMap because indices shifted
    const updateMap = (map: Record<number, any>) => {
      const newMap: Record<number, any> = {};
      Object.entries(map).forEach(([key, value]) => {
        const idx = parseInt(key);
        if (idx < id) newMap[idx] = value;
        if (idx > id) newMap[idx - 1] = value;
      });
      return newMap;
    };
    
    setManualEditsMap(prev => updateMap(prev));
    setAutoFixedMap(prev => updateMap(prev));
    
    const updateSet = (set: Set<number>) => {
      const newSet = new Set<number>();
      set.forEach(idx => {
        if (idx < id) newSet.add(idx);
        if (idx > id) newSet.add(idx - 1);
      });
      return newSet;
    };
    
    setIgnoredDuplicates(prev => updateSet(prev));
    setIgnoredPriceWarnings(prev => updateSet(prev));
    const nextCalcLogs = updateMap(calculationLogsMap);
    setCalculationLogsMap(nextCalcLogs);
    
    const processed = await processData(
      newData,
      mapping,
      regionRefData,
      ignoredDuplicates,
      autoFixedMap,
      manualEditsMap,
      ignoredPriceWarnings,
      nextCalcLogs
    );

    if (currentSessionId) {
      handleBulkUpdateRows(processed, true);
    }

    setEditingRowId(null);
  };

  // Begins a guided "review one flagged row at a time" queue over duplicate rows (reviewQueueType state
  // above drives the DuplicateComparisonModal rendered in the review step JSX further below).
  const startDuplicateReview = () => {
    const items = processedData.filter(r => r.isDuplicate && r.duplicateOf !== undefined);
    if (items.length === 0) return;
    setReviewQueueType('duplicate');
    setComparingDuplicate({ row1: items[0].duplicateOf!, row2: items[0].id });
  };

  // Same guided-review flow as startDuplicateReview() above, but for price-outlier flagged rows.
  const startPriceReview = () => {
    const items = processedData.filter(r => r.isPriceOutlier && r.priceOutlierRefRowId !== undefined);
    if (items.length === 0) return;
    setReviewQueueType('price');
    setComparingDuplicate({ row1: items[0].priceOutlierRefRowId!, row2: items[0].id });
  };

  // Runs whenever processedData/pendingQueueAdvance/reviewQueueType change: after the user resolves one
  // item in the duplicate/price review queue (started by startDuplicateReview/startPriceReview above),
  // this advances comparingDuplicate to the next flagged row, or closes the queue once none remain.
  useEffect(() => {
    if (!pendingQueueAdvance || !reviewQueueType) return;
    setPendingQueueAdvance(false);
    const items = reviewQueueType === 'duplicate'
      ? processedData.filter(r => r.isDuplicate && r.duplicateOf !== undefined)
      : processedData.filter(r => r.isPriceOutlier && r.priceOutlierRefRowId !== undefined);
    if (items.length > 0) {
      setComparingDuplicate({
        row1: reviewQueueType === 'duplicate' ? items[0].duplicateOf! : items[0].priceOutlierRefRowId!,
        row2: items[0].id,
      });
    } else {
      setReviewQueueType(null);
      setComparingDuplicate(null);
    }
  }, [processedData, pendingQueueAdvance, reviewQueueType]);

  // Keeps the review table's current page in range when the filtered row count shrinks (e.g. a row is
  // deleted, the Issues-Only filter is applied, or a fresh file is processed) — otherwise the table body
  // (which reads reviewPage directly) could render an empty page while showing stale page controls.
  useEffect(() => {
    const filteredCount = processedData.filter(row => {
      if (showOnlyErrors) return row.status === 'red';
      if (showOnlyCorrect) return row.status === 'green';
      if (showOnlyEdited) return manualEditsMap[row.id] !== undefined;
      return true;
    }).length;
    const totalPages = Math.max(1, Math.ceil(filteredCount / reviewPageSize));
    setReviewPage(p => Math.min(p, totalPages));
  }, [processedData, showOnlyErrors, showOnlyCorrect, showOnlyEdited, manualEditsMap, reviewPageSize]);

  // "Re-validate" button handler: treats the current data as the new baseline (originalRawData), clears
  // manual/auto-fix edit markers (but keeps dismissed duplicate/price warnings), then re-runs
  // handleCalculationSmartFix() below to recompute everything from scratch.
  const handleRevalidate = async () => {
    setIsAiProcessing(true);
    try {
      setOriginalRawData(JSON.parse(JSON.stringify(rawData)));
      setManualEditsMap({});
      setAutoFixedMap({});
      const processed = await handleCalculationSmartFix(rawData, mapping, true);
      if (currentSessionId) {
        handleBulkUpdateRows(processed, true);
      }
    } finally {
      setIsAiProcessing(false);
    }
  };

  // Discards all AI/calculation fixes and manual edits by restoring rawData from originalRawData (the
  // untouched copy captured at upload time / handleRevalidate) and clearing every edit-tracking map.
  const handleRevertAiFixes = async () => {
    const original = JSON.parse(JSON.stringify(originalRawData));
    setRawData(original);
    setAutoFixedMap({});
    setCalculationLogsMap({});
    setIgnoredDuplicates(new Set());
    setIgnoredPriceWarnings(new Set());

    const processed = await processData(
      original,
      mapping,
      regionRefData,
      new Set(),
      {},
      {},
      new Set(),
      {}
    );

    if (currentSessionId) {
      handleBulkUpdateRows(processed, true);
    }
  };

  /**
   * Performs deterministic calculations and data extractions (Mapping AI, not a real AI call — despite
   * the name, this is rule-based arithmetic, distinct from handleAiSmartFix() below which does call an AI model).
   * - Calculates Total Quantity from Case Size/Qty
   * - Splits "12 x 75cl" pack strings
   * - Calculates Total Value from Price/Qty
   * - Extracts currency symbols
   * Called right after mapping completes (handleMappingComplete above), from handleRevalidate above, and
   * from handleRowUpdate above when a quantity/price field is edited — anywhere quantities/totals might
   * need recomputing. Tracks what it changed in autoFixedMap/calculationLogsMap (shown in the review UI).
   */
  const handleCalculationSmartFix = async (
    customRawData?: any[],
    customMapping?: Record<string, string>,
    isAutoTrigger = false,
    overrideManualEdits?: Record<number, string[]>
  ): Promise<ProcessedRow[]> => {
    const dataToProcess = customRawData || rawData;
    const activeMapping = customMapping || mapping;

    if (dataToProcess.length === 0) return [];
    if (!isAutoTrigger) setIsAiProcessing(true);

    const newData = [...dataToProcess];
    const newAutoFixedMap: Record<number, string[]> = isAutoTrigger ? {} : { ...autoFixedMap };
    const newCalculationLogs: Record<number, Record<string, string>> = isAutoTrigger ? {} : { ...calculationLogsMap };

    newData.forEach((row, idx) => {
      const logs: Record<string, string> = { ...(newCalculationLogs[idx] || {}) };
      const fixedFields: string[] = [...(newAutoFixedMap[idx] || [])];

      // Helper to get value from raw row using mapping
      const getVal = (fieldKey: string) => {
        // Priority 1: Check the schema key itself (manual edits)
        if (row[fieldKey] !== undefined && row[fieldKey] !== null && String(row[fieldKey]).trim() !== '') return row[fieldKey];
        // Priority 2: Check virtual
        if (row[`__ai_calculated_${fieldKey}__`]) return row[`__ai_calculated_${fieldKey}__`];
        // Priority 3: Check mapped header, constant sentinel, or concat sentinel
        const header = activeMapping[fieldKey];
        if (!header) return undefined;
        if (header.startsWith('__const__')) return header.slice(9);
        if (header.startsWith('__concat__')) {
          try {
            const def = JSON.parse(header.slice(10));
            return (def.cols as string[]).map((c: string) => String(row[c] ?? '')).filter(Boolean).join(def.sep);
          } catch { return undefined; }
        }
        return row[header];
      };

      // Helper to set value in raw row using mapping
      const setVal = (fieldKey: string, value: any, log: string) => {
        // Use mapping header if exists, otherwise use a virtual header for unmapped calculations
        const header = activeMapping[fieldKey] || `__ai_calculated_${fieldKey}__`;
        if (header) {
          row[header] = value;
          if (!fixedFields.includes(fieldKey)) fixedFields.push(fieldKey);
          logs[fieldKey] = log;
        }
      };

      // 1. Pack Splitting (e.g. "12 x 75cl")
      // Check if case_size or bottle_size are missing but we have a "pack" or "description" column
      Object.entries(activeMapping).forEach(([fieldKey, header]) => {
        const val = String(row[header] || '');
        const packMatch = val.match(/(\d+)\s*[xX*]\s*(\d+(?:\.\d+)?)\s*(?:cl|ml|L|l)?/i);
        if (packMatch) {
          const size = parseInt(packMatch[1]);
          const vol = packMatch[2];
          
          if (!getVal('case_size')) {
            setVal('case_size', size, `Extracted from '${header}': ${val}`);
          }
          if (!getVal('size')) {
            setVal('size', vol, `Extracted from '${header}': ${val}`);
          }
        }
      });

      // 2. Quantity Calculations
      const caseSize = parseFloat(getVal('case_size'));
      const caseQty = parseFloat(getVal('case_quantity'));
      const totalQty = parseFloat(getVal('total_quantity'));

      if (!isNaN(caseSize) && !isNaN(caseQty) && (isNaN(totalQty) || !getVal('total_quantity')) && dataType !== 'sales_orders' && dataType !== 'purchase_orders') {
        setVal('total_quantity', caseSize * caseQty, `Calculated: Case Size (${caseSize}) × Case Quantity (${caseQty}) = ${caseSize * caseQty}`);
      } else if (!isNaN(totalQty) && !isNaN(caseSize) && (isNaN(caseQty) || !getVal('case_quantity')) && caseSize > 0) {
        setVal('case_quantity', totalQty / caseSize, `Calculated: Total Quantity (${totalQty}) ÷ Case Size (${caseSize}) = ${totalQty / caseSize}`);
      }

      // 3. Financial Calculations
      const priceField = (dataType === 'client_reserves' || dataType === 'purchase_orders') ? 'case_cost_price' : 'exc_vat_case';
      const unitPrice = normalizeCurrency(getVal(priceField)).value;
      const totalValue = normalizeCurrency(getVal('total')).value;
      const qty = parseFloat(getVal('total_quantity')) || totalQty;

      if (unitPrice !== null && !isNaN(qty) && (totalValue === null || !getVal('total'))) {
        setVal('total', unitPrice * qty, `Calculated: Unit Price (${unitPrice}) × Quantity (${qty}) = ${unitPrice * qty}`);
      }

      // 4. Geographical Consistency (Sub-Region -> Region -> Country)
      // REMOVED: Per User Rule D, we no longer auto-correct geography.
      // The system will flag inconsistencies as errors in processData for manual resolution.

      if (fixedFields.length > 0) {
        newAutoFixedMap[idx] = fixedFields;
        newCalculationLogs[idx] = logs;
      }
    });

    setRawData(newData);
    setAutoFixedMap(newAutoFixedMap);
    setCalculationLogsMap(newCalculationLogs);
    const processed = await processData(newData, activeMapping, regionRefData, ignoredDuplicates, newAutoFixedMap, overrideManualEdits || manualEditsMap, ignoredPriceWarnings, newCalculationLogs,
      (done, total) => setValidationProgress({ done, total }));
    if (!isAutoTrigger) setIsAiProcessing(false);
    return processed;
  };

  // Persists a batch of processed rows to the backend session (only rows that were actually changed,
  // unless forceAll is set). Called after most edit operations above (row update, delete, undo, revalidate,
  // AI fix) so the saved session in the DB stays in sync with what's shown on screen.
  const handleBulkUpdateRows = async (processed: ProcessedRow[], forceAll = false) => {
    if (!currentSessionId) return;
    
    // Only update rows that were actually modified (have autoFixedFields, calculationLogs or manualEdits) or if forcing all
    const rowsToUpdate = processed.filter(r => 
      forceAll ||
      (r.autoFixedFields && r.autoFixedFields.length > 0) || 
      (r.calculationLogs && Object.keys(r.calculationLogs).length > 0) ||
      (r.manualEdits && r.manualEdits.length > 0)
    ).map(r => ({
      rowIndex: r.id,
      content: r
    }));

    if (rowsToUpdate.length === 0) return;

    try {
      await authFetch(`/api/sessions/${currentSessionId}/rows/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: rowsToUpdate })
      });
    } catch (error) {
      console.error('Failed bulk update', error);
    }
  };

  /**
   * Uses an AI model (via the backend's /api/system/ai-fix proxy) to intelligently fix invalid ("red")
   * rows. Sends only red rows, batched, with PII fields (names, emails, bank details, addresses)
   * redacted before sending. Results are staged into pendingAiChanges/aiChangesSummary state (shown in
   * the AiFixReviewModal further below) rather than applied immediately, so the user can review first.
   */
  const handleAiSmartFix = async () => {
    if (processedData.length === 0) return;
    setIsAiProcessing(true);
    
    // Performance Optimization: Only send "red" status rows (those with errors)
    const rowsToFix = processedData.filter(r => r.status === 'red');
    if (rowsToFix.length === 0) {
      setIsAiProcessing(false);
      return;
    }

    try {
      const currentSchema = getCurrentSchema();
      const summaryList: any[] = [];
      const allFixedResults: any[] = [];

      // Process in larger batches since it's server-side proxy
      const batchSize = 25;
      for (let i = 0; i < rowsToFix.length; i += batchSize) {
        const SENSITIVE_FIELDS = [
          'forename', 'surname', 'email', 'mobile', 'phone', 
          'bank_account_name', 'bank_account_number', 'iban', 'swift'
        ];
        
        if (dataType !== 'inventory' && dataType !== 'client_reserves') {
          SENSITIVE_FIELDS.push('address_line_1', 'address_line_2', 'address_line_3', 'post_code', 'city', 'county', 'address');
        }

        const batch = rowsToFix.slice(i, i + batchSize).map(r => {
          const redactedRaw = { ...r.raw };
          Object.keys(redactedRaw).forEach(header => {
            const mappedField = Object.keys(mapping).find(key => mapping[key] === header);
            const fieldKey = mappedField || header;
            if (SENSITIVE_FIELDS.some(pii => fieldKey.toLowerCase().includes(pii))) {
              redactedRaw[header] = "[REDACTED_PII]";
            }
          });
          return { id: r.id, raw: redactedRaw };
        });

        const res = await authFetch('/api/system/ai-fix', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            batch,
            fields: currentSchema.fields.map(f => f.key),
            dataType
          })
        });

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          throw new Error(errorData.error || 'AI Fix failed');
        }
        const batchResults = await res.json();
        allFixedResults.push(...batchResults);

        // Build summary for modal
        batchResults.forEach((fixed: any) => {
          const originalRow = processedData.find(r => r.id === fixed.id);
          if (originalRow) {
            const changedFields = Object.keys(fixed).filter(k => k !== 'id' && String(fixed[k]) !== String(originalRow[k]));
            if (changedFields.length > 0) {
              summaryList.push({
                id: fixed.id,
                original: originalRow,
                fixed: fixed,
                fields: changedFields
              });
            }
          }
        });
      }

      setPendingAiChanges(allFixedResults);
      setAiChangesSummary(summaryList);
      setIsAiReviewModalOpen(true);
      
    } catch (error: any) {
      console.error("AI Fix Error:", error);
      alert(error.message || "AI Processing failed. Please try again later.");
    } finally {
      setIsAiProcessing(false);
    }
  };

  // Applies the AI-suggested fixes staged by handleAiSmartFix() above (optionally only a subset via
  // selectedRowIds, when the user deselects some in AiFixReviewModal), merges them into rawData, and re-validates.
  const confirmAiFixes = async (selectedRowIds?: number[]) => {
    let currentRawData = [...rawData];
    let currentAutoFixedMap = { ...autoFixedMap };
    let currentCalcLogs = { ...calculationLogsMap };
    const currentSchema = getCurrentSchema();

    // If selectedRowIds is provided, only apply those
    const changesToApply = selectedRowIds 
      ? pendingAiChanges.filter(c => selectedRowIds.includes(c.id))
      : pendingAiChanges;

    changesToApply.forEach((fixed: any) => {
      const rowIndex = processedData.findIndex(r => r.id === fixed.id);
      if (rowIndex !== -1) {
        const fieldsFixed: string[] = [];
        const rawRow = { ...currentRawData[fixed.id] };
        const logs: Record<string, string> = { ...(currentCalcLogs[fixed.id] || {}) };
        
        currentSchema.fields.forEach(field => {
          if (fixed[field.key] !== undefined) {
            const currentVal = processedData[rowIndex][field.key];
            if (String(fixed[field.key]) !== String(currentVal)) {
              rawRow[mapping[field.key] || field.key] = fixed[field.key];
              fieldsFixed.push(field.key);
              logs[field.key] = `AI Smart Fix: Moved/Cleaned to '${fixed[field.key]}'`;
            }
          }
        });

        if (fieldsFixed.length > 0) {
          currentRawData[fixed.id] = rawRow;
          currentAutoFixedMap[fixed.id] = Array.from(new Set([...(currentAutoFixedMap[fixed.id] || []), ...fieldsFixed]));
          currentCalcLogs[fixed.id] = logs;
        }
      }
    });

    setRawData(currentRawData);
    setAutoFixedMap(currentAutoFixedMap);
    setCalculationLogsMap(currentCalcLogs);
    
    const processed = await processData(
      currentRawData,
      mapping,
      regionRefData,
      ignoredDuplicates,
      currentAutoFixedMap,
      manualEditsMap,
      ignoredPriceWarnings,
      currentCalcLogs
    );

    if (currentSessionId) {
      handleBulkUpdateRows(processed);
    }

    setIsAiReviewModalOpen(false);
    setPendingAiChanges([]);
    setAiChangesSummary([]);
  };

  /**
   * Core Data Processing Engine — the single most important function in this file.
   * Iterates through every row of the raw data and applies:
   * 1. Schema Mapping (Raw Header -> Schema Key)
   * 2. Sanitization (Cleaning strings, numbers, LWINs)
   * 3. Validation (Required fields, Data types, Business logic)
   * 4. Duplicate Detection
   * Turns rawData (whatever shape came from the uploaded file or manual grid) into ProcessedRow[]
   * (processedData state), which is what the review step's table further below actually renders — every
   * cell, status color, and error message on screen comes from what this function computes.
   * Called after almost every edit in this file (upload, mapping, row edit, undo, delete, AI fix, revert,
   * revalidate) since any change to the inputs needs a fresh validation pass.
   *
   * @param data The raw data array
   * @param map The current column mapping
   * @param ignoredDups Set of duplicate IDs to ignore
   * @param overrideAutoFixed (Optional) Override for auto-fixed fields map
   * @param overrideManualEdits (Optional) Override for manual edits map
   */
  // Rows are validated in chunks with a yield (setTimeout 0) between each, instead of one long
  // synchronous pass, so a large file (thousands of rows) doesn't freeze the browser tab for the
  // duration of validation. onProgress (if given) is called after each chunk so callers can drive a
  // progress bar. This is why processData is async now — every call site below must await it.
  const processData = async (
    data: any[],
    map: Record<string, string>,
    refData: any[] = regionRefData,
    ignoredDups?: Set<number>,
    overrideAutoFixed?: Record<number, string[]>,
    overrideManualEdits?: Record<number, string[]>,
    ignoredPrice?: Set<number>,
    overrideCalcLogs?: Record<number, Record<string, string>>,
    onProgress?: (done: number, total: number) => void
  ): Promise<ProcessedRow[]> => {
    const myId = ++processDataLatestId.current;
    const result = await runProcessData(
      data, map, dataType, getCurrentSchema(), refData,
      ignoredDups ?? ignoredDuplicates,
      overrideAutoFixed ?? autoFixedMap,
      overrideManualEdits ?? manualEditsMap,
      ignoredPrice ?? ignoredPriceWarnings,
      overrideCalcLogs ?? calculationLogsMap,
      masterCellars,
      masterClients,
      onProgress
    );
    if (processDataLatestId.current === myId) {
      setProcessedData(result);
    }
    return result;
  };

  // Generates and downloads a blank Excel template for the current data type, using SCHEMAS for column
  // headers and highlighting mandatory fields in orange.
  const handleDownloadTemplate = () => downloadTemplate(dataType);

  // Finds the in-progress (not completed, not archived) saved session for a given data type — used by
  // renderDataTypeButton below to decide whether a data-type pill shows a "resume" state.
  const getActiveSessionForType = (type: DataType) => {
    return sessions.find(s => {
      if (s.status === 'completed' || s.disabled === 1) return false;
      try {
        const rawFields = (s as any).fields;
        const fields = rawFields ? (typeof rawFields === 'string' ? JSON.parse(rawFields) : rawFields) : {};
        if (fields.dataType === type) return true;
      } catch (e) {}
      return s.session_type && s.session_type.split(':')[0] === type;
    });
  };

  // Same as getActiveSessionForType above, but for the most recent completed session of a data type.
  const getCompletedSessionForType = (type: DataType) => {
    return sessions.find(s => {
      if (s.status !== 'completed' || s.disabled === 1) return false;
      try {
        const rawFields = (s as any).fields;
        const fields = rawFields ? (typeof rawFields === 'string' ? JSON.parse(rawFields) : rawFields) : {};
        if (fields.dataType === type) return true;
      } catch (e) {}
      return s.session_type && s.session_type.split(':')[0] === type;
    });
  };

  // "Start New" handler: archives (soft-deletes) whatever session is active/in-progress for the target
  // data type on the backend, clears its completed badge, and resets ALL local wizard state back to the
  // upload step so the user starts a fresh import for that data type. Wired to the "Start New" buttons in
  // renderDataTypeButton below and the header's reset button.
  const handleStartNew = async (idOrEvent?: number | React.MouseEvent, typeOverride?: DataType) => {
    // Handle polymorphic arguments correctly
    const specificSessionId = typeof idOrEvent === 'number' ? idOrEvent : undefined;
    
    // We determine the target type either from the argument (card click) or current state (header button click)
    const targetDataType = typeOverride || dataType;
    
    
    // 1. Determine which session we are archiving. 
    let sessionIdToArchive = specificSessionId || currentSessionId;
    
    // If no ID was passed and we don't have a global currentSessionId, look it up from the sessions list
    if (!sessionIdToArchive && targetDataType) {
      const activeSession = getActiveSessionForType(targetDataType);
      if (activeSession) {
        sessionIdToArchive = activeSession.id;
      }
    }
    
    if (sessionIdToArchive) {
      try {
        const resp = await authFetch(`/api/sessions/${sessionIdToArchive}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ disabled: 1, status: 'abandoned' })
        });
        
        if (!resp.ok) {
          const errorText = await resp.text();
          console.error('[App] Server-side archive failed:', resp.status, errorText);
        } else {
        }
      } catch (err) {
        console.error('[App] Network error archiving session:', err);
      }
    } else {
    }

    // --- Reset ALL local state to ensure a clean slate ---
    
    // 1. Clear completion flag for this specific type
    if (targetDataType) {
      const newCompleted = { ...completedTasks };
      if (newCompleted[targetDataType]) {
        delete newCompleted[targetDataType];
        setCompletedTasks(newCompleted);
        try {
          const metaOnly: Record<string, { fileName: string; completedAt: string }> = {};
          Object.keys(newCompleted).forEach(t => {
            metaOnly[t] = { fileName: newCompleted[t].fileName, completedAt: newCompleted[t].completedAt };
          });
          localStorage.setItem(completedStorageKey, JSON.stringify(metaOnly));
        } catch { /* ignore */ }
      }
    }

    // 2. Clear sessions locally immediately to feel faster
    if (sessionIdToArchive) {
      setSessions(prev => prev.filter(s => String(s.id) !== String(sessionIdToArchive)));
    }
    
    // 3. Global state UI reset
    setStep('upload');
    setRawData([]);
    setOriginalRawData([]);
    setHeaders([]);
    setMapping({});
    setProcessedData([]);
    setAutoFixedMap({});
    setManualEditsMap({});
    setCalculationLogsMap({});
    setIgnoredDuplicates(new Set());
    setIgnoredPriceWarnings(new Set());
    setHasAutoFixed(false);
    setShowOnlyErrors(false);
    setShowOnlyEdited(false);
    setCurrentSessionId(null);
    setFileName('');
    setDataType(targetDataType || 'inventory'); // Preserve the intended data type
    setIsRulesModalOpen(false);
    setOpenCompletedDropdown(null);
    setValidationError(null);
    setEditingRowId(null);
    setHistory([]);
    
    // Final refresh to ensure UI reflects DB state
    await loadSessions(); 
  };


  // Returns to the upload step without archiving anything (unlike handleStartNew) — just navigation, used by the logo click and back buttons.
  const goHome = () => {
    setStep('upload');
    setOpenCompletedDropdown(null);
    setValidationError(null);
    loadSessions();
  };

  // --- Top-level render branches ---
  // Before the main wizard JSX, handle the states that replace the whole app: admin panel, Auth0 loading,
  // logged-out, and backend auth error. Only once none of these apply do we fall through to the wizard below.

  // Admin panel short-circuit: renders instead of the wizard when showAdmin is toggled on from the header.
  if (showAdmin && currentUser) {
    return (
      <React.Suspense fallback={null}>
        <AdminPanel
          onBack={() => setShowAdmin(false)}
          currentUserForename={currentUser.forename || currentUser.display_name}
          currentOrgName={currentUser.organisation_name}
        />
      </React.Suspense>
    );
  }

  if (authLoading) return null;
  if (!isAuthenticated) { loginWithRedirect(); return null; }

  if (authError) {
    return (
      <div className="min-h-screen bg-[#F5F2ED] flex items-center justify-center p-8">
        <div className="max-w-md w-full bg-white rounded-2xl border border-rose-200 shadow-lg p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center mx-auto mb-4">
            <span className="text-rose-600 text-xl">!</span>
          </div>
          <h2 className="text-lg font-semibold text-[#1A1A1A] mb-2">Cannot start Druid</h2>
          <p className="text-sm text-rose-700 bg-rose-50 rounded-lg px-4 py-3 mb-4 text-left">{authError}</p>
          <p className="text-xs text-black/40">Update your <code className="font-mono bg-black/5 px-1 rounded">.env</code> file and restart the server.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f3f6f8] text-[#1b3040] font-sans">
      <AppHeader
        step={step}
        currentUser={currentUser}
        allGreen={allGreen}
        greenCount={greenCount}
        redCount={redCount}
        showOnlyCorrect={showOnlyCorrect}
        showOnlyErrors={showOnlyErrors}
        correctionsInputRef={correctionsInputRef}
        onGoHome={goHome}
        onShowAdmin={() => setShowAdmin(true)}
        onLogout={() => logout({ logoutParams: { returnTo: window.location.origin } })}
        onShowRules={() => setIsRulesModalOpen(true)}
        onMarkComplete={handleMarkAsComplete}
        onRemap={() => { setManualEditsMap({}); setAutoFixedMap({}); setCalculationLogsMap({}); setStep('map'); }}
        onStartNew={handleStartNew}
        onExportCorrect={handleExportCorrect}
        onExportErrors={handleExportErrors}
        onUploadCorrections={handleUploadCorrections}
        onExport={handleExport}
      />

      <main className="max-w-[98vw] mx-auto min-h-[calc(100vh-4rem)] flex flex-col justify-center px-8 py-10">
        <AnimatePresence mode="wait">
          {/* ===================== UPLOAD STEP ===================== */}
          {/* Data-type picker pills (renderDataTypeButton above) + either the FileUploader/manual-entry
              start (handleUpload, handleOpenManualEntry) or, if a session already exists for the chosen
              data type, a "session in progress" / "session completed" card (handleLoadSession,
              handleReopenSession, handleExportCompleted, handleStartNew). */}
          {step === 'upload' && (
            <UploadStep
              dataType={dataType}
              completedTasks={completedTasks}
              masterCellars={masterCellars}
              masterClients={masterClients}
              openCompletedDropdown={openCompletedDropdown}
              validationError={validationError}
              onSetDataType={setDataType}
              onSetOpenCompletedDropdown={setOpenCompletedDropdown}
              onSetValidationError={setValidationError}
              getActiveSessionForType={getActiveSessionForType}
              getCompletedSessionForType={getCompletedSessionForType}
              onLoadSession={handleLoadSession}
              onReopenSession={handleReopenSession}
              onExportCompleted={handleExportCompleted}
              onStartNew={handleStartNew}
              onClearMasterData={handleClearMasterData}
              onShowAddLocation={() => setShowAddLocationModal(true)}
              onDownloadTemplate={handleDownloadTemplate}
              onDownloadAllCompleted={handleDownloadAllCompleted}
              onUpload={handleUpload}
              onOpenManualEntry={handleOpenManualEntry}
            />
          )}

          {/* ===================== MANUAL ENTRY STEP ===================== */}
          {/* Only reached via handleOpenManualEntry -> handleStartManualEntry above (column picker modal
              is rendered separately, further below). ManualEntryGrid does the actual row-by-row data
              entry UI; onSubmit wires to handleManualSubmit above, which jumps straight to 'review'. */}
          {step === 'manual' && (
            <div className="max-w-[98vw] mx-auto space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-serif font-light">New {SCHEMAS[dataType].label} Entry</h2>
                  <p className="text-sm text-black/40 mt-1">Fill in the rows below. Required fields are marked with *</p>
                </div>
                <button
                  onClick={goHome}
                  className="flex items-center gap-2 px-4 py-2 bg-white border border-black/10 rounded-xl text-sm text-black/60 hover:text-black hover:border-black/20 transition-colors"
                >
                  <X size={14} />
                  Cancel
                </button>
              </div>
              <React.Suspense fallback={null}>
                <ManualEntryGrid
                  fields={getCurrentSchema().fields.filter(f => pickerSelectedKeys.has(f.key))}
                  onSubmit={handleManualSubmit}
                  onCancel={goHome}
                />
              </React.Suspense>
            </div>
          )}

          {/* ===================== MAP STEP ===================== */}
          {/* Delegates entirely to the SchemaMapper component: lets the user match uploaded CSV headers
              to schema fields (getCurrentSchema() above). onComplete calls handleMappingComplete above,
              which runs processData()/handleCalculationSmartFix() and advances to 'review'. */}
          {step === 'map' && (
            <React.Suspense fallback={null}>
              <SchemaMapper
                headers={headers}
                fields={getCurrentSchema().fields}
                onComplete={handleMappingComplete}
                onCancel={goHome}
                requireEitherOr={(['inventory', 'client_reserves', 'sales_orders', 'purchase_orders'] as DataType[]).includes(dataType) ? ['lwin7', 'listing_wine_name'] : undefined}
                previewRows={rawData.slice(0, 4)}
                initialMapping={Object.keys(mapping).length > 0 ? mapping : undefined}
              />
            </React.Suspense>
          )}

          {/* ===================== REVIEW STEP ===================== */}
          {/* The main workhorse screen: summary stat tiles (Total/Ready/Issues/Manual Fixes, click to
              filter), the bulk-fix suggestion banner (pendingBulkAction / applyBulkFix above), the
              toolbar (AI Smart Fix, Review Change, Undo AI Changes, Undo Edit, Review Duplicates/Prices —
              handleAiSmartFix, handleRevalidate, handleRevertAiFixes, handleUndo, startDuplicateReview,
              startPriceReview, all above), and further below the actual data table bound to processedData
              with inline editing via startEditingCell/handleRowUpdate. */}
          {step === 'review' && (
            <ReviewTable
              processedData={processedData}
              dataType={dataType}
              mapping={mapping}
              regionRefData={regionRefData}
              masterCellars={masterCellars}
              greenCount={greenCount}
              redCount={redCount}
              showOnlyErrors={showOnlyErrors}
              showOnlyCorrect={showOnlyCorrect}
              showOnlyEdited={showOnlyEdited}
              reviewPage={reviewPage}
              reviewPageSize={reviewPageSize}
              editingCell={editingCell}
              pendingBulkAction={pendingBulkAction}
              isAiProcessing={isAiProcessing}
              history={history}
              autoFixedMap={autoFixedMap}
              manualEditsMap={manualEditsMap}
              swapSourceKey={swapSourceKey}
              swapPickingTarget={swapPickingTarget}
              setShowOnlyErrors={setShowOnlyErrors}
              setShowOnlyCorrect={setShowOnlyCorrect}
              setShowOnlyEdited={setShowOnlyEdited}
              setReviewPage={setReviewPage}
              setReviewPageSize={setReviewPageSize}
              setEditingCell={setEditingCell}
              setProcessedData={setProcessedData}
              setPendingBulkAction={setPendingBulkAction}
              setSwapSourceKey={setSwapSourceKey}
              setSwapPickingTarget={setSwapPickingTarget}
              setComparingDuplicate={setComparingDuplicate}
              applyBulkFix={applyBulkFix}
              handleAiSmartFix={handleAiSmartFix}
              handleRevalidate={handleRevalidate}
              handleRevertAiFixes={handleRevertAiFixes}
              handleUndo={handleUndo}
              startDuplicateReview={startDuplicateReview}
              startPriceReview={startPriceReview}
              handleSwapColumns={handleSwapColumns}
              startEditingCell={startEditingCell}
              handleRowUpdate={handleRowUpdate}
              handleDeleteRow={handleDeleteRow}
              handleIgnoreDuplicate={handleIgnoreDuplicate}
              handleIgnorePriceWarning={handleIgnorePriceWarning}
              getCurrentSchema={getCurrentSchema}
            />
          )}
      </AnimatePresence>

      {/* --- Modals rendered outside the step switch, so they can float above any step --- */}

      {/* Side-by-side comparison for a duplicate or price-outlier row pair (comparingDuplicate state
          above). Drives the guided review queue via onKeep -> setPendingQueueAdvance (handled by the
          useEffect above that advances to the next flagged row). */}
      <AnimatePresence>
        {comparingDuplicate !== null && (
          <DuplicateComparisonModal
            row1={processedData.find(r => r.id === comparingDuplicate.row1)}
            row2={processedData.find(r => r.id === comparingDuplicate.row2)}
            type={processedData.find(r => r.id === comparingDuplicate.row2)?.isPriceOutlier ? 'price' : 'duplicate'}
            fields={SCHEMAS[dataType].fields}
            queueInfo={reviewQueueType ? {
              remaining: reviewQueueType === 'duplicate'
                ? processedData.filter(r => r.isDuplicate).length
                : processedData.filter(r => r.isPriceOutlier).length
            } : undefined}
            onKeep={(id) => {
              const row = processedData.find(r => r.id === id);
              if (row?.isPriceOutlier) {
                handleIgnorePriceWarning(id);
              } else {
                handleIgnoreDuplicate(id);
              }
              if (reviewQueueType) {
                setPendingQueueAdvance(true);
              } else {
                setComparingDuplicate(null);
              }
            }}
            onRemove={(id) => {
              handleDeleteRow(id);
              if (reviewQueueType) {
                setPendingQueueAdvance(true);
              } else {
                setComparingDuplicate(null);
              }
            }}
            onEdit={(rowId, fieldKey, newValue) => {
              const row = processedData.find(r => r.id === rowId);
              if (!row) return;
              handleRowUpdate({ ...row, [fieldKey]: newValue }, fieldKey);
            }}
            onClose={() => {
              setReviewQueueType(null);
              setComparingDuplicate(null);
            }}
          />
        )}
      </AnimatePresence>

      {/* Full-row edit modal (editingRowId state above, set by the "Fix Issue" button in the review table). onSave wires to handleRowUpdate above. */}
      <AnimatePresence>
        {editingRowId !== null && (
          <RowEditor
            row={processedData.find(r => r.id === editingRowId)}
            originalRow={processedData.find(r => r.id === editingRowId)?.duplicateOf !== undefined 
              ? processedData.find(r => r.id === processedData.find(r => r.id === editingRowId)?.duplicateOf) 
              : undefined}
            fields={getCurrentSchema().fields}
            onSave={handleRowUpdate}
            onDelete={handleDeleteRow}
            onClose={() => setEditingRowId(null)}
          />
        )}
      </AnimatePresence>
      {/* Add a new cellar/location to the master list (showAddLocationModal state above, opened from the + button on the Cellars pill). */}
      {showAddLocationModal && (
        <AddLocationModal
          onSave={handleAddLocation}
          onClose={() => setShowAddLocationModal(false)}
        />
      )}

      {/* Column picker modal for manual entry (showColumnPicker/pickerSelectedKeys state above, opened by
          handleOpenManualEntry). Required fields are locked on; optional fields are toggled here and the
          selection is confirmed by handleStartManualEntry above. */}
      {showColumnPicker && (
        <ColumnPickerModal
          dataType={dataType}
          schema={getCurrentSchema()}
          pickerSelectedKeys={pickerSelectedKeys}
          setPickerSelectedKeys={setPickerSelectedKeys}
          onConfirm={handleStartManualEntry}
          onClose={() => setShowColumnPicker(false)}
        />
      )}

      </main>

      {/* "Validation Rules" help modal, opened from the header button (isRulesModalOpen state above). */}
      <RulesModal
        isOpen={isRulesModalOpen}
        onClose={() => setIsRulesModalOpen(false)}
        dataType={dataType}
      />

      {/* Review/confirm modal for AI Smart Fix results (isAiReviewModalOpen/aiChangesSummary state above,
          populated by handleAiSmartFix). onConfirm applies the selected fixes via confirmAiFixes above. */}
      <AiFixReviewModal
        isOpen={isAiReviewModalOpen}
        onClose={() => setIsAiReviewModalOpen(false)}
        changes={aiChangesSummary}
        onConfirm={confirmAiFixes}
        onRevert={() => {
          setIsAiReviewModalOpen(false);
          setAiChangesSummary([]);
          setPendingAiChanges([]);
        }}
      />

      <ValidationProgressOverlay isValidating={isValidating} validationProgress={validationProgress} />

      <footer className="max-w-[98vw] mx-auto mt-20 pt-8 border-t border-black/10 flex justify-between items-center text-[10px] uppercase tracking-[0.2em] text-black/30">
        <div>© 2026 Druid</div>
      </footer>
    </div>
  );
}
