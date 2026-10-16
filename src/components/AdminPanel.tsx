// Admin backoffice UI: lets an admin user manage organisations and users, and browse sessions, the audit
// trail, and the master wine-region list. Rendered full-screen by App.tsx in place of the normal wizard
// whenever showAdmin is true and a user is logged in (see the `if (showAdmin && currentUser)` branch there).
// Talks directly to the FastAPI backend's /api/admin/* and /api/master/* endpoints (independent of the main
// import wizard's own API calls in App.tsx).
import React, { useState, useEffect, useCallback } from 'react';
import { useAuth0 } from '@auth0/auth0-react';

const API = '';

// Which sidebar tab/section of the admin panel is currently shown.
type Section = 'orgs' | 'users' | 'sessions' | 'audit' | 'regions';

// Shape of one row from GET /api/admin/organisations.
interface Org {
  organisation_id: number;
  name: string;
  organisation_type_ref: string | null;
  default_country_ref: string | null;
  default_currency_ref: string | null;
  disabled: boolean;
  created: string;
}

// Shape of one row from GET /api/admin/users.
interface User {
  user_id: number;
  organisation_id: number;
  organisation_name: string;
  forename: string | null;
  surname: string | null;
  display_name: string | null;
  alias: string | null;
  email: string | null;
  user_access: string | null;
  user_type: string | null;
  disabled: boolean;
  created: string;
}

// Shape of one row from GET /api/admin/sessions — an import session started via the main wizard in App.tsx.
interface Session {
  id: number;
  organisation_id: number;
  organisation_name: string;
  session_type: string;
  status: string;
  total_rows: number;
  created_at: string;
  updated_at: string;
  created_by_name: string | null;
}

// Shape of one row from GET /api/admin/audit — a single field-level change record.
interface AuditEntry {
  id: number;
  session_id: number;
  organisation_name: string;
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  change_type: string;
  created_at: string;
  created_by_name: string | null;
}

// Shape of one row from GET /api/master/regions — the read-only master wine-region reference list.
interface Region {
  Region: string;
  Type: string;
  Parent: string | null;
  Appellation: string | null;
  Classification: string | null;
  Designation: string | null;
}

// onBack returns to the main app (App.tsx sets showAdmin back to false).
// currentUserForename/currentOrgName are just displayed in the sidebar footer — they come from
// App.tsx's currentUser (the logged-in user record fetched after Auth0 login).
interface Props {
  onBack: () => void;
  currentUserForename: string;
  currentOrgName: string;
}

// Shared Tailwind class strings reused across every table/form in this file (th/td cells, inputs, buttons).
const th = 'text-left text-xs font-semibold text-gray-500 uppercase tracking-wide py-2 px-3 border-b border-gray-200 bg-gray-50 whitespace-nowrap';
const td = 'py-2 px-3 text-sm border-b border-gray-100 align-middle';
const inputCls = 'border border-gray-300 rounded px-2 py-1 text-sm w-full focus:outline-none focus:border-gray-400 font-sans';
const btn = 'px-3 py-1 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50 cursor-pointer font-sans';
const btnPrimary = 'px-3 py-1 text-xs rounded bg-gray-900 text-white hover:bg-gray-700 cursor-pointer font-sans border-0';
const btnDanger = 'px-3 py-1 text-xs rounded border border-gray-300 bg-white hover:bg-red-50 hover:border-red-300 hover:text-red-700 cursor-pointer font-sans';
const btnSuccess = 'px-3 py-1 text-xs rounded border border-gray-300 bg-white hover:bg-green-50 hover:border-green-300 hover:text-green-700 cursor-pointer font-sans';

export function AdminPanel({ onBack, currentUserForename, currentOrgName }: Props) {
  const { getAccessTokenSilently } = useAuth0();

  // Wrapper around fetch() that attaches the current Auth0 access token as a Bearer header — every admin
  // API call below goes through this so the backend can enforce the admin role check on each request.
  const authFetch = useCallback(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const token = await getAccessTokenSilently();
    return fetch(input, {
      ...init,
      headers: { ...init?.headers, Authorization: `Bearer ${token}` },
    });
  }, [getAccessTokenSilently]);

  const [section, setSection] = useState<Section>('orgs');
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [orgForm, setOrgForm] = useState<Partial<Org> | null>(null);
  const [userForm, setUserForm] = useState<Partial<User> | null>(null);
  const [newUserSetupUrl, setNewUserSetupUrl] = useState<string | null>(null);
  const [auth0Warning, setAuth0Warning] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [orgFilter, setOrgFilter] = useState('');
  const [auditOrgFilter, setAuditOrgFilter] = useState('');
  const [auditTypeFilter, setAuditTypeFilter] = useState('');
  const [sessionOrgFilter, setSessionOrgFilter] = useState('');
  const [sessionTypeFilter, setSessionTypeFilter] = useState('');
  const [regionSearch, setRegionSearch] = useState('');
  const [regionTypeFilter, setRegionTypeFilter] = useState('');

  // Fetches the data for one sidebar section. Orgs are lazily loaded alongside users/sessions/audit (only
  // fetched if not already in state) since those tables all need the org list for name lookups/filters.
  const loadSection = async (sec: Section) => {
    setLoading(true);
    setError(null);
    try {
      if (sec === 'orgs') {
        const r = await authFetch(`${API}/api/admin/organisations`);
        setOrgs(await r.json());
      } else if (sec === 'users') {
        const [ur, or_] = await Promise.all([
          authFetch(`${API}/api/admin/users`),
          orgs.length ? Promise.resolve(null) : authFetch(`${API}/api/admin/organisations`),
        ]);
        setUsers(await ur.json());
        if (or_) setOrgs(await or_.json());
      } else if (sec === 'sessions') {
        const [sr, or_] = await Promise.all([
          authFetch(`${API}/api/admin/sessions`),
          orgs.length ? Promise.resolve(null) : authFetch(`${API}/api/admin/organisations`),
        ]);
        setSessions(await sr.json());
        if (or_) setOrgs(await or_.json());
      } else if (sec === 'audit') {
        const [ar, or_] = await Promise.all([
          authFetch(`${API}/api/admin/audit`),
          orgs.length ? Promise.resolve(null) : authFetch(`${API}/api/admin/organisations`),
        ]);
        setAudit(await ar.json());
        if (or_) setOrgs(await or_.json());
      } else if (sec === 'regions') {
        const r = await authFetch(`${API}/api/master/regions`);
        setRegions(await r.json());
      }
    } catch {
      setError('Failed to load data. Is the backend running?');
    } finally {
      setLoading(false);
    }
  };

  // Reload data and reset filters/open forms whenever the active section changes.
  useEffect(() => {
    loadSection(section);
    setSearch('');
    setOrgForm(null);
    setUserForm(null);
  }, [section]);

  // Creates a new organisation (POST) or updates an existing one (PUT), based on whether orgForm already
  // has an organisation_id, then refreshes the orgs list.
  const saveOrg = async () => {
    if (!orgForm) return;
    const isNew = !orgForm.organisation_id;
    await authFetch(
      isNew ? `${API}/api/admin/organisations` : `${API}/api/admin/organisations/${orgForm.organisation_id}`,
      { method: isNew ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(orgForm) }
    );
    setOrgForm(null);
    loadSection('orgs');
  };

  // Enables or disables an organisation (soft toggle, not a delete) and refreshes the list.
  const toggleOrg = async (id: number, disable: boolean) => {
    await authFetch(`${API}/api/admin/organisations/${id}/${disable ? 'disable' : 'enable'}`, { method: 'POST' });
    loadSection('orgs');
  };

  // Creates a new user (POST) or updates an existing one (PUT). For a new user, the backend also
  // auto-provisions an Auth0 account; on success it may return a setup_url (password-set link to hand the
  // new user) and/or an auth0_error if that provisioning step failed but the DB record was still created.
  const saveUser = async () => {
    if (!userForm) return;
    const isNew = !userForm.user_id;
    let resp: Response;
    try {
      resp = await authFetch(
        isNew ? `${API}/api/admin/users` : `${API}/api/admin/users/${userForm.user_id}`,
        { method: isNew ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(userForm) }
      );
    } catch {
      setError('Network error — is the backend running?');
      return;
    }
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      setError((err as { detail?: string }).detail || `Save failed (${resp.status}).`);
      return;
    }
    if (isNew) {
      const result = await resp.json() as { setup_url?: string; auth0_error?: string };
      if (result.setup_url) setNewUserSetupUrl(result.setup_url);
      if (result.auth0_error) setAuth0Warning(`User created in the database, but Auth0 registration failed: ${result.auth0_error}. Add this user manually in the Auth0 dashboard.`);
    }
    setUserForm(null);
    loadSection('users');
  };

  // Enables or disables a user account and refreshes the list.
  const toggleUser = async (id: number, disable: boolean) => {
    await authFetch(`${API}/api/admin/users/${id}/${disable ? 'disable' : 'enable'}`, { method: 'POST' });
    loadSection('users');
  };

  // filteredOrgs/filteredUsers/filteredSessions/filteredAudit/filteredRegions apply the search box and
  // dropdown filters for each section entirely client-side (all rows for a section are fetched up front).
  const filteredOrgs = orgs.filter(o =>
    !search || o.name.toLowerCase().includes(search.toLowerCase())
  );

  const filteredUsers = users.filter(u => {
    const name = u.display_name || `${u.forename || ''} ${u.surname || ''}`.trim();
    const matchSearch = !search || name.toLowerCase().includes(search.toLowerCase()) || (u.email || '').toLowerCase().includes(search.toLowerCase());
    const matchOrg = !orgFilter || String(u.organisation_id) === orgFilter;
    return matchSearch && matchOrg;
  });

  const filteredSessions = sessions.filter(s => {
    const matchOrg = !sessionOrgFilter || String(s.organisation_id) === sessionOrgFilter;
    const matchType = !sessionTypeFilter || s.session_type === sessionTypeFilter;
    return matchOrg && matchType;
  });

  const filteredAudit = audit.filter(a => {
    const matchSearch = !search || (a.field_name || '').toLowerCase().includes(search.toLowerCase()) || (a.created_by_name || '').toLowerCase().includes(search.toLowerCase());
    const matchOrg = !auditOrgFilter || a.organisation_name === auditOrgFilter;
    const matchType = !auditTypeFilter || a.change_type === auditTypeFilter;
    return matchSearch && matchOrg && matchType;
  });

  const filteredRegions = regions.filter(r => {
    const matchSearch = !regionSearch || r.Region.toLowerCase().includes(regionSearch.toLowerCase());
    const matchType = !regionTypeFilter || r.Type === regionTypeFilter;
    return matchSearch && matchType;
  });

  const sessionTypes = [...new Set(sessions.map(s => s.session_type))].sort();
  const regionTypes = [...new Set(regions.map(r => r.Type))].sort();

  // Renders one sidebar nav button, highlighted when it's the active section.
  const navItem = (sec: Section, label: string) => (
    <button
      key={sec}
      onClick={() => setSection(sec)}
      className={`w-full text-left px-2 py-1.5 text-sm rounded mb-0.5 ${section === sec ? 'bg-gray-100 font-medium' : 'hover:bg-gray-50'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans flex">
      {/* Sidebar */}
      <aside className="w-44 flex-shrink-0 border-r border-gray-200 p-3 flex flex-col">
        <div className="mb-4 pb-3 border-b border-gray-200">
          <div className="font-semibold text-sm">Druid</div>
          <div className="text-xs text-gray-400 uppercase tracking-wider mt-0.5">Admin</div>
        </div>

        <div className="text-xs text-gray-400 uppercase tracking-wider mb-1 px-1">Management</div>
        {navItem('orgs', 'Organisations')}
        {navItem('users', 'Users')}
        {navItem('sessions', 'Sessions')}

        <div className="text-xs text-gray-400 uppercase tracking-wider mb-1 px-1 mt-3">Data</div>
        {navItem('audit', 'Audit Trail')}
        {navItem('regions', 'Regions')}

        <div className="mt-auto pt-3 border-t border-gray-200">
          <div className="text-xs text-gray-600 px-1 mb-0.5">{currentUserForename}</div>
          <div className="text-xs text-gray-400 px-1 mb-2">{currentOrgName}</div>
          <button onClick={onBack} className="text-xs text-gray-400 hover:text-gray-700 px-1 cursor-pointer">
            ← Back to app
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 p-6 overflow-x-auto">
        {loading && <p className="text-sm text-gray-400 mb-4">Loading…</p>}
        {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

        {/* ORGANISATIONS */}
        {section === 'orgs' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h1 className="text-base font-semibold">Organisations</h1>
              <button className={btnPrimary} onClick={() => { setOrgForm({}); }}>+ New Organisation</button>
            </div>

            {orgForm !== null && (
              <div className="border border-gray-200 rounded p-4 mb-4 bg-gray-50">
                <h2 className="text-sm font-medium mb-3">{orgForm.organisation_id ? 'Edit Organisation' : 'New Organisation'}</h2>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Name *</label>
                    <input className={inputCls} value={orgForm.name || ''} onChange={e => setOrgForm({ ...orgForm, name: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Type</label>
                    <input className={inputCls} value={orgForm.organisation_type_ref || ''} placeholder="e.g. wine_merchant" onChange={e => setOrgForm({ ...orgForm, organisation_type_ref: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Country</label>
                    <input className={inputCls} value={orgForm.default_country_ref || ''} placeholder="e.g. GB" onChange={e => setOrgForm({ ...orgForm, default_country_ref: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Currency</label>
                    <input className={inputCls} value={orgForm.default_currency_ref || ''} placeholder="e.g. GBP" onChange={e => setOrgForm({ ...orgForm, default_currency_ref: e.target.value })} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className={btnPrimary} onClick={saveOrg}>Save</button>
                  <button className={btn} onClick={() => setOrgForm(null)}>Cancel</button>
                </div>
              </div>
            )}

            <div className="mb-3">
              <input className="border border-gray-300 rounded px-2 py-1 text-sm font-sans w-52 focus:outline-none" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>

            <table className="border-collapse w-full">
              <thead>
                <tr>
                  <th className={th}>ID</th>
                  <th className={th}>Name</th>
                  <th className={th}>Type</th>
                  <th className={th}>Country</th>
                  <th className={th}>Currency</th>
                  <th className={th}>Status</th>
                  <th className={th}>Created</th>
                  <th className={th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrgs.map(o => (
                  <tr key={o.organisation_id} className="hover:bg-gray-50">
                    <td className={`${td} text-gray-400 font-mono text-xs`}>{o.organisation_id}</td>
                    <td className={`${td} font-medium`}>{o.name}</td>
                    <td className={`${td} text-gray-500`}>{o.organisation_type_ref || '—'}</td>
                    <td className={`${td} text-gray-500`}>{o.default_country_ref || '—'}</td>
                    <td className={`${td} text-gray-500`}>{o.default_currency_ref || '—'}</td>
                    <td className={td}>{o.disabled ? 'Disabled' : 'Active'}</td>
                    <td className={`${td} text-gray-400 font-mono text-xs`}>{o.created ? String(o.created).slice(0, 10) : '—'}</td>
                    <td className={td}>
                      <div className="flex gap-1">
                        <button className={btn} onClick={() => setOrgForm(o)}>Edit</button>
                        {o.disabled
                          ? <button className={btnSuccess} onClick={() => toggleOrg(o.organisation_id, false)}>Enable</button>
                          : <button className={btnDanger} onClick={() => toggleOrg(o.organisation_id, true)}>Disable</button>
                        }
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && filteredOrgs.length === 0 && (
                  <tr><td colSpan={8} className="py-6 text-center text-sm text-gray-400">No organisations found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* USERS */}
        {section === 'users' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h1 className="text-base font-semibold">Users</h1>
              <button className={btnPrimary} onClick={() => { setUserForm({}); setNewUserSetupUrl(null); setAuth0Warning(null); }}>+ New User</button>
            </div>

            {auth0Warning && (
              <div className="border border-amber-200 bg-amber-50 rounded p-4 mb-4 flex items-start justify-between gap-3">
                <p className="text-sm text-amber-800 flex-1">{auth0Warning}</p>
                <button
                  className="px-2 py-1 text-xs rounded border border-amber-200 bg-white text-amber-700 hover:bg-amber-50 cursor-pointer font-sans flex-shrink-0"
                  onClick={() => setAuth0Warning(null)}
                >
                  Dismiss
                </button>
              </div>
            )}

            {newUserSetupUrl && (
              <div className="border border-green-200 bg-green-50 rounded p-4 mb-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-green-800 mb-1">User created. Send this link to let them set their password:</p>
                    <p className="text-xs font-mono text-green-700 break-all bg-white border border-green-200 rounded px-2 py-1.5">{newUserSetupUrl}</p>
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button
                      className="px-2 py-1 text-xs rounded border border-green-300 bg-white text-green-700 hover:bg-green-50 cursor-pointer font-sans"
                      onClick={() => navigator.clipboard.writeText(newUserSetupUrl)}
                    >
                      Copy
                    </button>
                    <button
                      className="px-2 py-1 text-xs rounded border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 cursor-pointer font-sans"
                      onClick={() => setNewUserSetupUrl(null)}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            )}

            {userForm !== null && (
              <div className="border border-gray-200 rounded p-4 mb-4 bg-gray-50">
                <h2 className="text-sm font-medium mb-3">{userForm.user_id ? 'Edit User' : 'New User'}</h2>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Forename</label>
                    <input className={inputCls} value={userForm.forename || ''} onChange={e => setUserForm({ ...userForm, forename: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Surname</label>
                    <input className={inputCls} value={userForm.surname || ''} onChange={e => setUserForm({ ...userForm, surname: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Display Name</label>
                    <input className={inputCls} value={userForm.display_name || ''} onChange={e => setUserForm({ ...userForm, display_name: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Alias</label>
                    <input className={inputCls} value={userForm.alias || ''} onChange={e => setUserForm({ ...userForm, alias: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Email</label>
                    <input className={inputCls} type="email" value={userForm.email || ''} onChange={e => setUserForm({ ...userForm, email: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Organisation *</label>
                    <select className={inputCls} value={userForm.organisation_id || ''} onChange={e => setUserForm({ ...userForm, organisation_id: Number(e.target.value) })}>
                      <option value="">Select…</option>
                      {orgs.filter(o => !o.disabled).map(o => (
                        <option key={o.organisation_id} value={o.organisation_id}>{o.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Access Level</label>
                    <select className={inputCls} value={userForm.user_access || 'user'} onChange={e => setUserForm({ ...userForm, user_access: e.target.value })}>
                      <option value="user">user</option>
                      <option value="admin">admin</option>
                    </select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className={btnPrimary} onClick={saveUser}>Save</button>
                  <button className={btn} onClick={() => setUserForm(null)}>Cancel</button>
                </div>
              </div>
            )}

            <div className="mb-3 flex gap-2 flex-wrap">
              <input className="border border-gray-300 rounded px-2 py-1 text-sm font-sans w-52 focus:outline-none" placeholder="Search name or email…" value={search} onChange={e => setSearch(e.target.value)} />
              <select className="border border-gray-300 rounded px-2 py-1 text-sm font-sans focus:outline-none" value={orgFilter} onChange={e => setOrgFilter(e.target.value)}>
                <option value="">All organisations</option>
                {orgs.map(o => <option key={o.organisation_id} value={String(o.organisation_id)}>{o.name}</option>)}
              </select>
            </div>

            <table className="border-collapse w-full">
              <thead>
                <tr>
                  <th className={th}>ID</th>
                  <th className={th}>Name</th>
                  <th className={th}>Email</th>
                  <th className={th}>Organisation</th>
                  <th className={th}>Access</th>
                  <th className={th}>Status</th>
                  <th className={th}>Created</th>
                  <th className={th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map(u => {
                  const name = u.display_name || `${u.forename || ''} ${u.surname || ''}`.trim() || '—';
                  return (
                    <tr key={u.user_id} className="hover:bg-gray-50">
                      <td className={`${td} text-gray-400 font-mono text-xs`}>{u.user_id}</td>
                      <td className={`${td} font-medium`}>{name}</td>
                      <td className={`${td} text-gray-500 font-mono text-xs`}>{u.email || '—'}</td>
                      <td className={`${td} text-gray-500`}>{u.organisation_name}</td>
                      <td className={td}>{u.user_access || '—'}</td>
                      <td className={td}>{u.disabled ? 'Disabled' : 'Active'}</td>
                      <td className={`${td} text-gray-400 font-mono text-xs`}>{u.created ? String(u.created).slice(0, 10) : '—'}</td>
                      <td className={td}>
                        <div className="flex gap-1">
                          <button className={btn} onClick={() => setUserForm(u)}>Edit</button>
                          {u.disabled
                            ? <button className={btnSuccess} onClick={() => toggleUser(u.user_id, false)}>Enable</button>
                            : <button className={btnDanger} onClick={() => toggleUser(u.user_id, true)}>Disable</button>
                          }
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!loading && filteredUsers.length === 0 && (
                  <tr><td colSpan={8} className="py-6 text-center text-sm text-gray-400">No users found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* SESSIONS */}
        {section === 'sessions' && (
          <div>
            <h1 className="text-base font-semibold mb-4">Sessions</h1>
            <div className="mb-3 flex gap-2 flex-wrap">
              <select className="border border-gray-300 rounded px-2 py-1 text-sm font-sans focus:outline-none" value={sessionOrgFilter} onChange={e => setSessionOrgFilter(e.target.value)}>
                <option value="">All organisations</option>
                {orgs.map(o => <option key={o.organisation_id} value={String(o.organisation_id)}>{o.name}</option>)}
              </select>
              <select className="border border-gray-300 rounded px-2 py-1 text-sm font-sans focus:outline-none" value={sessionTypeFilter} onChange={e => setSessionTypeFilter(e.target.value)}>
                <option value="">All types</option>
                {sessionTypes.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <table className="border-collapse w-full">
              <thead>
                <tr>
                  <th className={th}>ID</th>
                  <th className={th}>Organisation</th>
                  <th className={th}>Type</th>
                  <th className={th}>Status</th>
                  <th className={th}>Rows</th>
                  <th className={th}>Created by</th>
                  <th className={th}>Created</th>
                  <th className={th}>Updated</th>
                </tr>
              </thead>
              <tbody>
                {filteredSessions.map(s => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className={`${td} text-gray-400 font-mono text-xs`}>{s.id}</td>
                    <td className={`${td} text-gray-600`}>{s.organisation_name}</td>
                    <td className={td}>{s.session_type}</td>
                    <td className={td}>{s.status}</td>
                    <td className={`${td} font-mono text-xs`}>{s.total_rows}</td>
                    <td className={`${td} text-gray-500`}>{s.created_by_name || '—'}</td>
                    <td className={`${td} text-gray-400 font-mono text-xs`}>{s.created_at ? String(s.created_at).slice(0, 10) : '—'}</td>
                    <td className={`${td} text-gray-400 font-mono text-xs`}>{s.updated_at ? String(s.updated_at).slice(0, 10) : '—'}</td>
                  </tr>
                ))}
                {!loading && filteredSessions.length === 0 && (
                  <tr><td colSpan={8} className="py-6 text-center text-sm text-gray-400">No sessions found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* AUDIT TRAIL */}
        {section === 'audit' && (
          <div>
            <h1 className="text-base font-semibold mb-4">Audit Trail</h1>
            <div className="mb-3 flex gap-2 flex-wrap">
              <input className="border border-gray-300 rounded px-2 py-1 text-sm font-sans w-52 focus:outline-none" placeholder="Filter by user or field…" value={search} onChange={e => setSearch(e.target.value)} />
              <select className="border border-gray-300 rounded px-2 py-1 text-sm font-sans focus:outline-none" value={auditOrgFilter} onChange={e => setAuditOrgFilter(e.target.value)}>
                <option value="">All organisations</option>
                {orgs.map(o => <option key={o.organisation_id} value={o.name}>{o.name}</option>)}
              </select>
              <select className="border border-gray-300 rounded px-2 py-1 text-sm font-sans focus:outline-none" value={auditTypeFilter} onChange={e => setAuditTypeFilter(e.target.value)}>
                <option value="">All types</option>
                <option value="CREATE">CREATE</option>
                <option value="UPDATE">UPDATE</option>
              </select>
            </div>
            <table className="border-collapse w-full">
              <thead>
                <tr>
                  <th className={th}>Timestamp</th>
                  <th className={th}>User</th>
                  <th className={th}>Organisation</th>
                  <th className={th}>Session</th>
                  <th className={th}>Field</th>
                  <th className={th}>Old value</th>
                  <th className={th}>New value</th>
                  <th className={th}>Type</th>
                </tr>
              </thead>
              <tbody>
                {filteredAudit.map(a => (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className={`${td} text-gray-400 font-mono text-xs`}>{a.created_at ? String(a.created_at).slice(0, 16).replace('T', ' ') : '—'}</td>
                    <td className={td}>{a.created_by_name || '—'}</td>
                    <td className={`${td} text-gray-500`}>{a.organisation_name}</td>
                    <td className={`${td} text-gray-400 font-mono text-xs`}>#{a.session_id}</td>
                    <td className={`${td} font-mono text-xs`}>{a.field_name || '—'}</td>
                    <td className={`${td} text-red-600 font-mono text-xs`}>{a.old_value && a.old_value !== 'NULL' ? a.old_value : '—'}</td>
                    <td className={`${td} text-green-700 font-mono text-xs`}>{a.new_value && a.new_value !== 'NULL' ? a.new_value : '—'}</td>
                    <td className={`${td} font-mono text-xs`}>{a.change_type}</td>
                  </tr>
                ))}
                {!loading && filteredAudit.length === 0 && (
                  <tr><td colSpan={8} className="py-6 text-center text-sm text-gray-400">No audit entries found.</td></tr>
                )}
              </tbody>
            </table>
            {audit.length === 500 && (
              <p className="text-xs text-gray-400 mt-2">Showing latest 500 entries.</p>
            )}
          </div>
        )}

        {/* REGIONS */}
        {section === 'regions' && (
          <div>
            <h1 className="text-base font-semibold mb-1">Regions</h1>
            <p className="text-xs text-gray-400 mb-4">Read only — {regions.length} entries</p>
            <div className="mb-3 flex gap-2 flex-wrap">
              <input className="border border-gray-300 rounded px-2 py-1 text-sm font-sans w-52 focus:outline-none" placeholder="Search by name…" value={regionSearch} onChange={e => setRegionSearch(e.target.value)} />
              <select className="border border-gray-300 rounded px-2 py-1 text-sm font-sans focus:outline-none" value={regionTypeFilter} onChange={e => setRegionTypeFilter(e.target.value)}>
                <option value="">All types</option>
                {regionTypes.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <table className="border-collapse w-full">
              <thead>
                <tr>
                  <th className={th}>Region name</th>
                  <th className={th}>Type</th>
                  <th className={th}>Parent</th>
                  <th className={th}>Appellation</th>
                  <th className={th}>Classification</th>
                  <th className={th}>Designation</th>
                </tr>
              </thead>
              <tbody>
                {filteredRegions.slice(0, 200).map((r, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className={`${td} font-medium`}>{r.Region}</td>
                    <td className={`${td} text-gray-500`}>{r.Type}</td>
                    <td className={`${td} text-gray-500`}>{r.Parent || '—'}</td>
                    <td className={`${td} text-gray-500`}>{r.Appellation || '—'}</td>
                    <td className={`${td} text-gray-500`}>{r.Classification || '—'}</td>
                    <td className={`${td} text-gray-500`}>{r.Designation || '—'}</td>
                  </tr>
                ))}
                {!loading && filteredRegions.length === 0 && (
                  <tr><td colSpan={6} className="py-6 text-center text-sm text-gray-400">No regions found.</td></tr>
                )}
              </tbody>
            </table>
            {filteredRegions.length > 200 && (
              <p className="text-xs text-gray-400 mt-2">Showing 200 of {filteredRegions.length}. Refine the search to narrow results.</p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
