"use client";

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, LogOut, Briefcase, Search, Plus, Save,
  Trash2, Edit3, X, CheckCircle, AlertCircle
} from 'lucide-react';
import {
  collection, getDocs, doc, addDoc, updateDoc, deleteDoc, serverTimestamp
} from 'firebase/firestore';
import { db } from '@/firebase/config';
import { useAuth } from '@/context/AuthContext';

const AdminMatterManagement = () => {
  const { user, signOut } = useAuth();
  const router = useRouter();

  const [matters, setMatters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: 'name', direction: 'asc' });

  // Inline editing
  const [editingMatter, setEditingMatter] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  // Messages
  const [successMessage, setSuccessMessage] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);

  // Add form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newMatter, setNewMatter] = useState({ name: '', clientName: '' });
  const [addingMatter, setAddingMatter] = useState(false);
  const [addError, setAddError] = useState(null);

  const fetchMatters = useCallback(async () => {
    try {
      const snapshot = await getDocs(collection(db, 'matters'));
      const docs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setMatters(docs);
    } catch (err) {
      console.error('Error fetching matters:', err);
      setErrorMessage('Failed to load matters');
      setTimeout(() => setErrorMessage(null), 3000);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMatters();
  }, [fetchMatters]);

  const handleLogout = async () => {
    await signOut();
    router.push('/');
  };

  // Sorting
  const handleSort = (key) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const getSortIndicator = (key) => {
    if (sortConfig.key !== key) return '';
    return sortConfig.direction === 'asc' ? ' ↑' : ' ↓';
  };

  // Parse dates from Firestore Timestamps or strings.
  // Stable identity (no closure deps) so the line-129 useMemo dep array
  // doesn't change every render — react-hooks/exhaustive-deps.
  const parseDate = useCallback((val) => {
    if (!val) return null;
    if (val.seconds) return new Date(val.seconds * 1000);
    if (val.toDate) return val.toDate();
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }, []);

  const formatDate = (val) => {
    const d = parseDate(val);
    if (!d) return '—';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // Unique client names for datalist autocomplete
  const clientNames = useMemo(() => {
    return [...new Set(matters.map((m) => m.clientName).filter(Boolean))].sort();
  }, [matters]);

  // Filter and sort
  const filteredAndSorted = useMemo(() => {
    let result = matters;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (m) =>
          (m.name || '').toLowerCase().includes(q) ||
          (m.clientName || '').toLowerCase().includes(q) ||
          (m.createdBy || '').toLowerCase().includes(q)
      );
    }

    result = [...result].sort((a, b) => {
      const { key, direction } = sortConfig;
      const mult = direction === 'asc' ? 1 : -1;

      if (key === 'createdAt' || key === 'lastUsedAt') {
        const da = parseDate(a[key]);
        const db_ = parseDate(b[key]);
        if (!da && !db_) return 0;
        if (!da) return 1;
        if (!db_) return -1;
        return (da.getTime() - db_.getTime()) * mult;
      }

      const va = (a[key] || '').toLowerCase();
      const vb = (b[key] || '').toLowerCase();
      return va.localeCompare(vb) * mult;
    });

    return result;
  }, [matters, searchQuery, sortConfig, parseDate]);

  // Inline editing handlers
  const handleStartEdit = (matter) => {
    setEditingMatter({ id: matter.id, name: matter.name || '', clientName: matter.clientName || '' });
  };

  const handleCancelEdit = () => {
    setEditingMatter(null);
  };

  const handleSaveEdit = async () => {
    if (!editingMatter) return;

    const name = editingMatter.name.trim();
    if (!name) {
      setErrorMessage('Matter name cannot be empty');
      setTimeout(() => setErrorMessage(null), 3000);
      return;
    }

    try {
      setSavingId(editingMatter.id);
      await updateDoc(doc(db, 'matters', editingMatter.id), {
        name,
        clientName: editingMatter.clientName.trim(),
      });

      setMatters((prev) =>
        prev.map((m) =>
          m.id === editingMatter.id
            ? { ...m, name, clientName: editingMatter.clientName.trim() }
            : m
        )
      );

      setEditingMatter(null);
      setSuccessMessage('Matter updated');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error('Error updating matter:', err);
      setErrorMessage('Failed to update matter');
      setTimeout(() => setErrorMessage(null), 3000);
    } finally {
      setSavingId(null);
    }
  };

  // Delete
  const handleDelete = async (matter) => {
    if (!confirm(`Are you sure you want to delete matter "${matter.name}"?`)) return;

    try {
      setDeletingId(matter.id);
      await deleteDoc(doc(db, 'matters', matter.id));
      setMatters((prev) => prev.filter((m) => m.id !== matter.id));

      if (editingMatter?.id === matter.id) setEditingMatter(null);

      setSuccessMessage(`Matter "${matter.name}" deleted`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error('Error deleting matter:', err);
      setErrorMessage('Failed to delete matter');
      setTimeout(() => setErrorMessage(null), 3000);
    } finally {
      setDeletingId(null);
    }
  };

  // Add new matter
  const handleAddMatter = async (e) => {
    e.preventDefault();
    setAddError(null);

    const name = newMatter.name.trim();
    const clientName = newMatter.clientName.trim();

    if (!name) {
      setAddError('Matter name is required');
      return;
    }

    if (matters.some((m) => (m.name || '').toLowerCase() === name.toLowerCase() && (m.clientName || '').toLowerCase() === clientName.toLowerCase())) {
      setAddError('A matter with this name and client already exists');
      return;
    }

    try {
      setAddingMatter(true);
      const docRef = await addDoc(collection(db, 'matters'), {
        name,
        clientName,
        createdAt: serverTimestamp(),
        createdBy: user?.email || 'unknown',
        lastUsedAt: null,
      });

      setMatters((prev) => [
        ...prev,
        { id: docRef.id, name, clientName, createdAt: new Date(), createdBy: user?.email || 'unknown', lastUsedAt: null },
      ]);

      setNewMatter({ name: '', clientName: '' });
      setShowAddForm(false);
      setSuccessMessage(`Matter "${name}" created`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error('Error adding matter:', err);
      setAddError('Failed to create matter');
    } finally {
      setAddingMatter(false);
    }
  };

  // Stats
  const uniqueClients = useMemo(() => new Set(matters.map((m) => m.clientName).filter(Boolean)).size, [matters]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <div className="mt-4 text-xl text-gray-700">Loading matters...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/admin" className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors">
                <ArrowLeft className="w-5 h-5" />
                <span>Back to Admin</span>
              </Link>
              <div className="h-6 w-px bg-gray-300"></div>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-100 rounded-lg">
                  <Briefcase className="w-5 h-5 text-purple-600" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Matter Management</h1>
                  <p className="text-sm text-gray-600">View, edit, and manage matters</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {user && (
                <div className="flex items-center gap-3">
                  {user.photoURL && (
                    <img src={user.photoURL} alt={user.displayName || 'User'} className="w-8 h-8 rounded-full" />
                  )}
                  <div className="text-sm">
                    <div className="font-medium text-gray-900">{user.displayName}</div>
                    <div className="text-gray-500">{user.email}</div>
                  </div>
                </div>
              )}
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span>Logout</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="text-sm text-gray-600">Total Matters</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">{matters.length}</div>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="text-sm text-gray-600">Unique Clients</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">{uniqueClients}</div>
          </div>
        </div>

        {/* Messages */}
        {(errorMessage || successMessage) && (
          <div className="mb-4">
            {errorMessage && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}
            {successMessage && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-green-50 border border-green-200 text-green-700">
                <CheckCircle className="w-5 h-5 flex-shrink-0" />
                <span>{successMessage}</span>
              </div>
            )}
          </div>
        )}

        {/* Search and Add */}
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="relative flex-1 max-w-md">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-gray-400" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              placeholder="Search by name, client, or creator..."
            />
          </div>
          <button
            onClick={() => { setShowAddForm(!showAddForm); setAddError(null); }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            <span>{showAddForm ? 'Cancel' : 'Add Matter'}</span>
          </button>
        </div>

        {/* Add Form */}
        {showAddForm && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">Add New Matter</h3>
            <form onSubmit={handleAddMatter} className="flex items-end gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">Matter Name *</label>
                <input
                  type="text"
                  value={newMatter.name}
                  onChange={(e) => setNewMatter((prev) => ({ ...prev, name: e.target.value }))}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  placeholder="Enter matter name"
                />
              </div>
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">Client Name</label>
                <input
                  type="text"
                  value={newMatter.clientName}
                  onChange={(e) => setNewMatter((prev) => ({ ...prev, clientName: e.target.value }))}
                  list="client-names-add"
                  className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  placeholder="Enter client name"
                />
                <datalist id="client-names-add">
                  {clientNames.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
              <button
                type="submit"
                disabled={addingMatter}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                  addingMatter
                    ? 'bg-gray-400 cursor-not-allowed text-white'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                {addingMatter ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Adding...</span>
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    <span>Add</span>
                  </>
                )}
              </button>
            </form>
            {addError && (
              <div className="flex items-center gap-2 mt-3 text-sm text-red-600">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{addError}</span>
              </div>
            )}
          </div>
        )}

        {/* Table */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Briefcase className="w-5 h-5 text-gray-600" />
                <h2 className="text-lg font-semibold text-gray-900">Matters</h2>
              </div>
              <span className="text-sm text-gray-500">
                {filteredAndSorted.length}{filteredAndSorted.length !== matters.length ? ` of ${matters.length}` : ''} matter{filteredAndSorted.length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>

          {filteredAndSorted.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              {searchQuery ? 'No matters match your search.' : 'No matters found.'}
            </div>
          ) : (
            <table className="w-full divide-y divide-gray-200 table-fixed">
              <thead className="bg-gray-50">
                <tr>
                  {[
                    { key: 'name', label: 'Name', width: 'w-[25%]' },
                    { key: 'clientName', label: 'Client', width: 'w-[20%]' },
                    { key: 'createdBy', label: 'Created By', width: 'w-[15%]' },
                    { key: 'createdAt', label: 'Created', width: 'w-[12%]' },
                    { key: 'lastUsedAt', label: 'Last Used', width: 'w-[12%]' },
                  ].map((col) => (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      className={`${col.width} px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700 select-none`}
                    >
                      {col.label}{getSortIndicator(col.key)}
                    </th>
                  ))}
                  <th className="w-[16%] px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredAndSorted.map((matter) => {
                  const isEditing = editingMatter?.id === matter.id;
                  const isSaving = savingId === matter.id;
                  const isDeleting = deletingId === matter.id;

                  return (
                    <tr key={matter.id} className="hover:bg-gray-50">
                      {/* Name */}
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editingMatter.name}
                            onChange={(e) => setEditingMatter((prev) => ({ ...prev, name: e.target.value }))}
                            className="w-full px-2 py-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                            autoFocus
                          />
                        ) : (
                          <div className="text-sm font-medium text-gray-900 truncate">{matter.name || '—'}</div>
                        )}
                      </td>
                      {/* Client */}
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <>
                            <input
                              type="text"
                              value={editingMatter.clientName}
                              onChange={(e) => setEditingMatter((prev) => ({ ...prev, clientName: e.target.value }))}
                              list={`client-names-${matter.id}`}
                              className="w-full px-2 py-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                            />
                            <datalist id={`client-names-${matter.id}`}>
                              {clientNames.map((c) => (
                                <option key={c} value={c} />
                              ))}
                            </datalist>
                          </>
                        ) : (
                          <div className="text-sm text-gray-700 truncate">{matter.clientName || '—'}</div>
                        )}
                      </td>
                      {/* Created By */}
                      <td className="px-4 py-3 text-sm text-gray-500 truncate">
                        {matter.createdBy || '—'}
                      </td>
                      {/* Created */}
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {formatDate(matter.createdAt)}
                      </td>
                      {/* Last Used */}
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {formatDate(matter.lastUsedAt)}
                      </td>
                      {/* Actions */}
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {isEditing ? (
                            <>
                              <button
                                onClick={handleSaveEdit}
                                disabled={isSaving}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-green-50 text-green-600 hover:bg-green-100 transition-colors"
                              >
                                {isSaving ? (
                                  <div className="w-3 h-3 border-2 border-green-400 border-t-transparent rounded-full animate-spin"></div>
                                ) : (
                                  <Save className="w-3 h-3" />
                                )}
                                <span>Save</span>
                              </button>
                              <button
                                onClick={handleCancelEdit}
                                disabled={isSaving}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-gray-50 text-gray-600 hover:bg-gray-100 transition-colors"
                              >
                                <X className="w-3 h-3" />
                                <span>Cancel</span>
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => handleStartEdit(matter)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                              >
                                <Edit3 className="w-3 h-3" />
                                <span>Edit</span>
                              </button>
                              <button
                                onClick={() => handleDelete(matter)}
                                disabled={isDeleting}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                              >
                                {isDeleting ? (
                                  <div className="w-3 h-3 border-2 border-red-400 border-t-transparent rounded-full animate-spin"></div>
                                ) : (
                                  <Trash2 className="w-3 h-3" />
                                )}
                                <span>Delete</span>
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminMatterManagement;
