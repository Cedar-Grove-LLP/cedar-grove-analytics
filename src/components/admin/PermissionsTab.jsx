"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { Save, ShieldCheck, CheckCircle, AlertCircle } from 'lucide-react';
import { collection, getDocs, doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db, waitForAuth } from '@/firebase/config';
import { useAuth } from '@/context/AuthContext';
import { sortBySeniority } from '@/utils/seniority.mjs';

// Manages permissions/{email} — the Firestore-backed replacement for the
// hardcoded partial-admin / downloads-access / transactions-ops-access
// email allowlists (see SEC-016 in the security audit). Writes here are
// picked up by AuthContext on the affected user's next sign-in/reload, and
// enforced server-side by firestore.rules' isPartialAdmin() /
// hasDownloadsAccess() / hasTransactionsOpsAccess() helpers.
const FLAGS = [
  { key: 'partialAdmin', label: 'Partial Admin', description: 'Most admin pages, excluding User Management' },
  { key: 'downloadsAccess', label: 'Downloads Access', description: 'Downloads-only restricted dashboard' },
  { key: 'transactionsOpsAccess', label: 'Transactions + Ops Access', description: 'Transactions/Ops-only restricted dashboard' },
];

const buildEditsFromUsers = (users) => {
  const edits = {};
  if (users && users.length > 0) {
    users.forEach(u => {
      const email = (u.email || '').toLowerCase();
      if (!email) return;
      edits[email] = {
        name: u.name || u.id,
        partialAdmin: u.permissions?.partialAdmin === true,
        downloadsAccess: u.permissions?.downloadsAccess === true,
        transactionsOpsAccess: u.permissions?.transactionsOpsAccess === true,
        // Which flags changed since the last load/save — only these are
        // included in the write, so saving one toggle can't clobber a
        // different flag someone else changed in another tab/session
        // between this tab's load and its save.
        dirtyFields: {},
      };
    });
  }
  return edits;
};

const PermissionsTab = ({ users, allUsers }) => {
  const { user, userEmail } = useAuth();

  const [permissionsByEmail, setPermissionsByEmail] = useState(null);
  const [loadError, setLoadError] = useState(null);

  // Loaded on demand rather than through the global FirestoreDataContext
  // cache — only this full-admin-only tab needs it, so there's no reason
  // to fetch it for every session (see SEC-008: minimize what's fetched
  // outside of an explicit admin action).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await waitForAuth();
        const snap = await getDocs(collection(db, 'permissions'));
        if (cancelled) return;
        const map = {};
        snap.docs.forEach(d => { map[d.id] = d.data(); });
        setPermissionsByEmail(map);
      } catch (error) {
        console.error('Error loading permissions:', error);
        if (!cancelled) setLoadError('Failed to load permissions');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const usersWithPermissions = useMemo(() => {
    const source = (allUsers && allUsers.length > 0) ? allUsers : users;
    return sortBySeniority(source, (u) => u.name || u.id)
      .filter(u => u.email)
      .map(u => ({ ...u, permissions: permissionsByEmail?.[(u.email || '').toLowerCase()] }));
  }, [allUsers, users, permissionsByEmail]);

  const [edits, setEdits] = useState({});
  const [savingEmail, setSavingEmail] = useState(null);
  const [saveStatus, setSaveStatus] = useState(null);

  useEffect(() => {
    if (permissionsByEmail === null) return; // wait for the initial load
    setEdits(buildEditsFromUsers(usersWithPermissions));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usersWithPermissions.map(u => (u.email || '').toLowerCase()).join(','), permissionsByEmail]);

  const handleToggle = (email, flag) => {
    setEdits(prev => ({
      ...prev,
      [email]: {
        ...prev[email],
        [flag]: !prev[email][flag],
        dirtyFields: { ...prev[email].dirtyFields, [flag]: true },
      },
    }));
  };

  const handleSave = async (email) => {
    const rowEdits = edits[email];
    if (!rowEdits) return;
    const dirtyKeys = FLAGS.map(f => f.key).filter(k => rowEdits.dirtyFields[k]);
    if (dirtyKeys.length === 0) return;

    try {
      setSavingEmail(email);
      await waitForAuth();

      const hasAnyFlag = FLAGS.some(f => rowEdits[f.key]);

      if (hasAnyFlag) {
        // Merge-write only the fields toggled in this session — a plain
        // setDoc of all three flags would silently revert a flag changed
        // by another admin session between this tab's load and its save.
        const payload = { updatedAt: serverTimestamp(), updatedBy: user?.email || userEmail || 'unknown' };
        dirtyKeys.forEach(k => { payload[k] = rowEdits[k]; });
        await setDoc(doc(db, 'permissions', email), payload, { merge: true });
      } else {
        // All three flags are now false — remove the doc entirely rather
        // than leaving an all-false doc around (keeps `permissions` a
        // sparse allowlist, matching the semantics of the arrays it
        // replaced, and avoids a stub doc with no flag fields at all).
        await deleteDoc(doc(db, 'permissions', email));
      }

      setEdits(prev => ({ ...prev, [email]: { ...prev[email], dirtyFields: {} } }));
      setSaveStatus('success');
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (error) {
      console.error('Error saving permissions:', error);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus(null), 3000);
    } finally {
      setSavingEmail(null);
    }
  };

  const rows = Object.entries(edits);

  if (permissionsByEmail === null && !loadError) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <div className="mt-4 text-xl text-gray-700">Loading permissions...</div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center max-w-md">
          <div className="text-red-600 text-xl mb-4">Error loading data</div>
          <div className="text-gray-600">{loadError}</div>
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center max-w-md">
          <div className="text-gray-900 text-xl mb-4">No users with an email on file</div>
          <div className="text-gray-600">Add an email in Role Management before granting permissions.</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 p-4 bg-blue-50 rounded-lg text-sm text-blue-800">
        Grants here replace the old hardcoded email allowlists and are enforced by Firestore security rules,
        not just the UI. Changes take effect the next time the affected person signs in or reloads the app.
      </div>

      {saveStatus && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-lg mb-6 ${saveStatus === 'success' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
          {saveStatus === 'success' ? (<><CheckCircle className="w-5 h-5" /><span>Permissions saved successfully!</span></>) : (<><AlertCircle className="w-5 h-5" /><span>Error saving changes. Please try again.</span></>)}
        </div>
      )}

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Team Member</th>
                {FLAGS.map(f => (
                  <th key={f.key} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" title={f.description}>
                    {f.label}
                  </th>
                ))}
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {rows.map(([email, rowEdits]) => {
                const isDirty = Object.values(rowEdits.dirtyFields).some(Boolean);
                return (
                <tr key={email} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                        <ShieldCheck className="w-4 h-4 text-blue-600" />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-gray-900">{rowEdits.name}</div>
                        <div className="text-xs text-gray-500">{email}</div>
                      </div>
                    </div>
                  </td>
                  {FLAGS.map(f => (
                    <td key={f.key} className="px-6 py-4 whitespace-nowrap">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={rowEdits[f.key]}
                        onClick={() => handleToggle(email, f.key)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${rowEdits[f.key] ? 'bg-green-500' : 'bg-gray-300'}`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${rowEdits[f.key] ? 'translate-x-6' : 'translate-x-1'}`} />
                      </button>
                    </td>
                  ))}
                  <td className="px-6 py-4 whitespace-nowrap">
                    {isDirty ? (
                      <span className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-full bg-yellow-100 text-yellow-800">Unsaved</span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800">Saved</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <button
                      onClick={() => handleSave(email)}
                      disabled={savingEmail === email || !isDirty}
                      className={`inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                        !isDirty
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : savingEmail === email
                            ? 'bg-blue-100 text-blue-400 cursor-wait'
                            : 'bg-blue-600 text-white hover:bg-blue-700'
                      }`}
                    >
                      {savingEmail === email ? (
                        <><div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>Saving...</>
                      ) : (
                        <><Save className="w-3 h-3" />Save</>
                      )}
                    </button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default PermissionsTab;
