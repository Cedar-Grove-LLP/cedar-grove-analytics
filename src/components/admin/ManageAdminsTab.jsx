"use client";

import React, { useState, useEffect } from 'react';
import {
  UserPlus,
  Trash2,
  Users,
  Mail,
  User,
  CheckCircle,
  AlertCircle,
  Shield
} from 'lucide-react';
import { collection, getDocs, doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/firebase/config';
import { compareBySeniority } from '@/utils/seniority.mjs';
import { useAuth } from '@/context/AuthContext';

const ManageAdminsTab = () => {
  const { user } = useAuth();

  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  // New admin form state
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [newAdminName, setNewAdminName] = useState('');
  const [formError, setFormError] = useState(null);

  // Fetch all admins
  useEffect(() => {
    const fetchAdmins = async () => {
      try {
        setLoading(true);
        setError(null);

        const adminsSnapshot = await getDocs(collection(db, 'admins'));
        const adminList = adminsSnapshot.docs.map(doc => ({
          id: doc.id,
          email: doc.data().email || doc.id,
          name: doc.data().name || '',
          addedAt: doc.data().addedAt?.toDate() || null,
        }));

        // Staff admins lead in firm seniority order; other admins trail alphabetically.
        adminList.sort((a, b) => compareBySeniority(a.name || a.email, b.name || b.email));

        setAdmins(adminList);
      } catch (err) {
        console.error('Error fetching admins:', err);
        setError('Failed to load admin users');
      } finally {
        setLoading(false);
      }
    };

    fetchAdmins();
  }, []);

  const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handleAddAdmin = async (e) => {
    e.preventDefault();
    setFormError(null);
    setSuccessMessage(null);

    const email = newAdminEmail.trim().toLowerCase();
    const name = newAdminName.trim();

    if (!email) {
      setFormError('Email is required');
      return;
    }

    if (!isValidEmail(email)) {
      setFormError('Please enter a valid email address');
      return;
    }

    if (!name) {
      setFormError('Name is required');
      return;
    }

    if (admins.some(admin => admin.email.toLowerCase() === email)) {
      setFormError('This email is already an admin');
      return;
    }

    try {
      setSaving(true);

      const adminDocRef = doc(db, 'admins', email);
      await setDoc(adminDocRef, {
        email: email,
        name: name,
        addedAt: serverTimestamp(),
        addedBy: user?.email || 'unknown',
      });

      setAdmins(prev => [...prev, {
        id: email,
        email: email,
        name: name,
        addedAt: new Date(),
      }].sort((a, b) => compareBySeniority(a.name || a.email, b.name || b.email)));

      setNewAdminEmail('');
      setNewAdminName('');
      setSuccessMessage(`${name} has been added as an admin`);
      setTimeout(() => setSuccessMessage(null), 3000);

    } catch (err) {
      console.error('Error adding admin:', err);
      setFormError('Failed to add admin. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveAdmin = async (adminEmail) => {
    if (adminEmail.toLowerCase() === user?.email?.toLowerCase()) {
      setError("You cannot remove yourself as an admin");
      setTimeout(() => setError(null), 3000);
      return;
    }

    if (!confirm(`Are you sure you want to remove ${adminEmail} as an admin?`)) {
      return;
    }

    try {
      setDeleting(adminEmail);

      await deleteDoc(doc(db, 'admins', adminEmail));

      setAdmins(prev => prev.filter(admin => admin.email !== adminEmail));
      setSuccessMessage('Admin removed successfully');
      setTimeout(() => setSuccessMessage(null), 3000);

    } catch (err) {
      console.error('Error removing admin:', err);
      setError('Failed to remove admin. Please try again.');
      setTimeout(() => setError(null), 3000);
    } finally {
      setDeleting(null);
    }
  };

  const formatDate = (date) => {
    if (!date) return 'Unknown';
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <div className="mt-4 text-xl text-gray-700">Loading admin users...</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Status Messages */}
      {(error || successMessage) && (
        <div className="mb-6">
          {error && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700">
              <AlertCircle className="w-5 h-5" />
              <span>{error}</span>
            </div>
          )}
          {successMessage && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-green-50 border border-green-200 text-green-700">
              <CheckCircle className="w-5 h-5" />
              <span>{successMessage}</span>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Add New Admin Form */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center gap-2 mb-6">
              <UserPlus className="w-5 h-5 text-blue-600" />
              <h2 className="text-lg font-semibold text-gray-900">Add New Admin</h2>
            </div>

            <form onSubmit={handleAddAdmin} className="space-y-4">
              {formError && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <label htmlFor="admin-email" className="block text-sm font-medium text-gray-700 mb-1">
                  Email Address
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Mail className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    type="email"
                    id="admin-email"
                    value={newAdminEmail}
                    onChange={(e) => setNewAdminEmail(e.target.value)}
                    className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                    placeholder="admin@example.com"
                  />
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Must match their Google account email
                </p>
              </div>

              <div>
                <label htmlFor="admin-name" className="block text-sm font-medium text-gray-700 mb-1">
                  Full Name
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <User className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    type="text"
                    id="admin-name"
                    value={newAdminName}
                    onChange={(e) => setNewAdminName(e.target.value)}
                    className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                    placeholder="John Smith"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={saving}
                className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                  saving
                    ? 'bg-gray-400 cursor-not-allowed text-white'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                {saving ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Adding...</span>
                  </>
                ) : (
                  <>
                    <UserPlus className="w-4 h-4" />
                    <span>Add Admin</span>
                  </>
                )}
              </button>
            </form>

            <div className="mt-6 p-4 bg-blue-50 rounded-lg">
              <h3 className="text-sm font-medium text-blue-800 mb-2">How it works</h3>
              <ul className="text-xs text-blue-700 space-y-1">
                <li>• Enter the users Google account email</li>
                <li>• They can sign in immediately after being added</li>
                <li>• Admins can access all admin features</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Current Admins List */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-gray-600" />
                  <h2 className="text-lg font-semibold text-gray-900">Current Admins</h2>
                </div>
                <span className="text-sm text-gray-500">{admins.length} total</span>
              </div>
            </div>

            {admins.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                No admin users found. Add one using the form.
              </div>
            ) : (
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      User
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Added
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {admins.map((admin) => (
                    <tr key={admin.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                            <Shield className="w-5 h-5 text-blue-600" />
                          </div>
                          <div>
                            <div className="text-sm font-medium text-gray-900">
                              {admin.name || 'No name'}
                              {admin.email.toLowerCase() === user?.email?.toLowerCase() && (
                                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                                  You
                                </span>
                              )}
                            </div>
                            <div className="text-sm text-gray-500">{admin.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {formatDate(admin.addedAt)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <button
                          onClick={() => handleRemoveAdmin(admin.email)}
                          disabled={deleting === admin.email || admin.email.toLowerCase() === user?.email?.toLowerCase()}
                          className={`inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                            admin.email.toLowerCase() === user?.email?.toLowerCase()
                              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                              : deleting === admin.email
                                ? 'bg-red-100 text-red-400 cursor-wait'
                                : 'bg-red-50 text-red-600 hover:bg-red-100'
                          }`}
                          title={admin.email.toLowerCase() === user?.email?.toLowerCase() ? "You cannot remove yourself" : "Remove admin"}
                        >
                          {deleting === admin.email ? (
                            <>
                              <div className="w-3 h-3 border-2 border-red-400 border-t-transparent rounded-full animate-spin"></div>
                              <span>Removing...</span>
                            </>
                          ) : (
                            <>
                              <Trash2 className="w-3 h-3" />
                              <span>Remove</span>
                            </>
                          )}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ManageAdminsTab;
