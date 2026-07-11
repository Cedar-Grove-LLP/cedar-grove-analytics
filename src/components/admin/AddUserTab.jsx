"use client";

import React, { useState } from 'react';
import { UserPlus, Mail, User, Users, CheckCircle, AlertCircle } from 'lucide-react';
import { doc, setDoc } from 'firebase/firestore';
import { db, waitForAuth } from '@/firebase/config';

const EMPLOYMENT_TYPES = ['FTE', 'PTE'];

const AddUserTab = ({ users, allUsers, refetch }) => {
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('Attorney');
  const [newEmploymentType, setNewEmploymentType] = useState('PTE');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handleAddUser = async (e) => {
    e.preventDefault();
    setFormError(null);
    setSuccessMessage(null);

    const name = newName.trim();
    const email = newEmail.trim().toLowerCase();

    if (!name) {
      setFormError('Full name is required');
      return;
    }

    if (email && !isValidEmail(email)) {
      setFormError('Please enter a valid email address');
      return;
    }

    // Check for duplicate user ID (name is used as document ID)
    if (allUsers.some(u => u.id === name || u.name === name)) {
      setFormError('A user with this name already exists');
      return;
    }

    // Check for duplicate email
    if (email && allUsers.some(u => u.email && u.email.toLowerCase() === email)) {
      setFormError('A user with this email already exists');
      return;
    }

    try {
      setSaving(true);

      await waitForAuth();

      await setDoc(doc(db, 'users', name), {
        name: name,
        ...(email && { email }),
        role: newRole,
        employmentType: newEmploymentType,
        rates: [],
        targets: [],
      });

      // Clear form
      setNewName('');
      setNewEmail('');
      setNewRole('Attorney');
      setNewEmploymentType('PTE');
      setSuccessMessage(`${name} has been added successfully`);
      setTimeout(() => setSuccessMessage(null), 3000);

      await refetch();
    } catch (err) {
      console.error('Error adding user:', err);
      setFormError('Failed to add user. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Add User Form */}
      <div className="lg:col-span-1">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center gap-2 mb-6">
            <UserPlus className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-semibold text-gray-900">Add New User</h2>
          </div>

          <form onSubmit={handleAddUser} className="space-y-4">
            {formError && (
              <div role="alert" className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            {successMessage && (
              <div role="status" className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">
                <CheckCircle className="w-4 h-4 flex-shrink-0" />
                <span>{successMessage}</span>
              </div>
            )}

            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                Full Name
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <User className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type="text"
                  id="name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  placeholder="John Smith"
                />
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Used as the user ID in the database
              </p>
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                Email Address <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type="email"
                  id="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  placeholder="john@cedargrovellp.com"
                />
              </div>
            </div>

            <div>
              <label htmlFor="role" className="block text-sm font-medium text-gray-700 mb-1">
                Role
              </label>
              <input
                type="text"
                id="role"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                placeholder="e.g. Attorney"
              />
            </div>

            <div>
              <label htmlFor="employmentType" className="block text-sm font-medium text-gray-700 mb-1">
                Employment Type
              </label>
              <select
                id="employmentType"
                value={newEmploymentType}
                onChange={(e) => setNewEmploymentType(e.target.value)}
                className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm bg-white"
              >
                {EMPLOYMENT_TYPES.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
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
                  <span>Add User</span>
                </>
              )}
            </button>
          </form>

          <div className="mt-6 p-4 bg-blue-50 rounded-lg">
            <h3 className="text-sm font-medium text-blue-800 mb-2">How it works</h3>
            <ul className="text-xs text-blue-700 space-y-1">
              <li>• The full name is used as the unique user ID</li>
              <li>• New users default to Part-Time Employee (PTE)</li>
              <li>• Set utilization targets in the Utilization Targets tab</li>
              <li>• Billing rates can be added after creation</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Current Users List */}
      <div className="lg:col-span-2">
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-gray-600" />
                <h2 className="text-lg font-semibold text-gray-900">Current Users</h2>
              </div>
              <span className="text-sm text-gray-500">{users.length} total</span>
            </div>
          </div>

          {users.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              No users found. Add one using the form.
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                          <Users className="w-4 h-4 text-blue-600" />
                        </div>
                        <span className="text-sm font-medium text-gray-900">{user.name || user.id}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {user.email || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {user.role || 'Attorney'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-full ${
                        user.employmentType === 'FTE'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-orange-100 text-orange-800'
                      }`}>
                        {user.employmentType || 'FTE'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default AddUserTab;
