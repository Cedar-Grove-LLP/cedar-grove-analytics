"use client";

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, LogOut, Users, UserPlus, Shield } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useUsers } from '@/hooks/useFirestoreData';
import { useFirestoreCache } from '@/context/FirestoreDataContext';
import { filterHiddenAttorneys } from '@/utils/hiddenAttorneys.mjs';
import { sortBySeniority } from '@/utils/seniority.mjs';
import RoleManagementTab from '@/components/admin/RoleManagementTab';
import AddUserTab from '@/components/admin/AddUserTab';
import ManageAdminsTab from '@/components/admin/ManageAdminsTab';

const TABS = [
  { key: 'roles', label: 'Role Management', icon: Users },
  { key: 'add-user', label: 'Add User', icon: UserPlus },
  { key: 'admins', label: 'Manage Admins', icon: Shield },
];

const AdminUserManagement = () => {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const { users: allUsers, loading: usersLoading, error: usersError } = useUsers();
  const { refetch } = useFirestoreCache();

  const [activeTab, setActiveTab] = useState('roles');

  const handleLogout = async () => {
    await signOut();
    router.push('/');
  };

  // Filter out hidden users and sort by name
  const users = useMemo(() => {
    if (!allUsers || allUsers.length === 0) return [];
    const allNames = allUsers.map(u => u.name || u.id);
    const visibleNames = filterHiddenAttorneys(allNames);
    return sortBySeniority(
      allUsers.filter(u => visibleNames.includes(u.name || u.id)),
      u => u.name || u.id,
    );
  }, [allUsers]);

  if (usersLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <div className="mt-4 text-xl text-gray-700">Loading user management...</div>
        </div>
      </div>
    );
  }

  if (usersError) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center max-w-md">
          <div className="text-red-600 text-xl mb-4">Error loading data</div>
          <div className="text-gray-600 mb-4">{usersError}</div>
          <Link href="/admin" className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
            Back to Admin
          </Link>
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
              <div>
                <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
                <p className="text-sm text-gray-600">Manage team members, roles, and employment types</p>
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

      {/* Tab Navigation */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex gap-1 border-b border-gray-200 mt-4">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
                activeTab === tab.key
                  ? 'text-blue-600 border-blue-600'
                  : 'text-gray-500 border-transparent hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
        {activeTab === 'roles' && (
          <RoleManagementTab users={users} allUsers={allUsers} refetch={refetch} />
        )}
        {activeTab === 'add-user' && (
          <AddUserTab users={users} allUsers={allUsers} refetch={refetch} />
        )}
        {activeTab === 'admins' && (
          <ManageAdminsTab />
        )}
      </div>
    </div>
  );
};

export default AdminUserManagement;
