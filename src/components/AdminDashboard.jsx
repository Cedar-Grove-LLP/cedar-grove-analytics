"use client";

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Users, LogOut, ArrowLeft, Shield, FileText, DollarSign, Receipt, Briefcase, TrendingUp, CalendarClock } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

const AdminDashboard = () => {
  const { user, isAdmin, signOut } = useAuth();
  const router = useRouter();

  const handleLogout = async () => {
    await signOut();
    router.push('/');
  };

  const adminLinks = [
    {
      title: 'User Management',
      description: 'Manage team members, roles, and employment types',
      href: '/admin/user-management',
      icon: Users,
      color: 'bg-blue-500',
    },
    {
      title: 'Billing Summaries',
      description: 'Generate detailed billing breakdowns by month and client',
      href: '/billing-summaries',
      icon: FileText,
      color: 'bg-green-500',
    },
    {
      title: 'Invoices',
      description: 'View invoice payment status, outstanding balances, and send reminders',
      href: '/admin/invoices',
      icon: Receipt,
      color: 'bg-amber-500',
    },
    {
      title: 'Billing KPIs',
      description: 'Average payment time, realization rate, and AR aging by client and firm-wide',
      href: '/admin/billing-kpis',
      icon: TrendingUp,
      color: 'bg-indigo-500',
    },
    {
      title: 'Transactions',
      description: 'View Mercury bank transactions, expenses, and payments',
      href: '/admin/transactions',
      icon: DollarSign,
      color: 'bg-emerald-500',
    },
    {
      title: 'Matters',
      description: 'View, edit, and manage matters for billing and time tracking',
      href: '/admin/matters',
      icon: Briefcase,
      color: 'bg-purple-500',
    },
    {
      title: 'Time-Off Debug',
      description: 'Inspect calendar OOO entries, attorney matching, and holidays',
      href: '/admin/timeoff-debug',
      icon: CalendarClock,
      color: 'bg-rose-500',
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link 
                href="/" 
                className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
                <span>Back to Dashboard</span>
              </Link>
              <div className="h-6 w-px bg-gray-300"></div>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <Shield className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Admin Panel</h1>
                  <p className="text-sm text-gray-600">Manage your Cedar Grove Analytics settings</p>
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              {user && (
                <div className="flex items-center gap-3">
                  {user.photoURL && (
                    <img 
                      src={user.photoURL} 
                      alt={user.displayName || 'User'}
                      className="w-8 h-8 rounded-full"
                    />
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

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {adminLinks.filter(link => isAdmin || link.href !== '/admin/user-management').map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md hover:border-gray-300 transition-all group"
            >
              <div className="flex items-start gap-4">
                <div className={`p-3 rounded-lg ${link.color}`}>
                  <link.icon className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
                    {link.title}
                  </h3>
                  <p className="text-sm text-gray-600 mt-1">
                    {link.description}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* Quick Stats or Info */}
        <div className="mt-8 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Admin Information</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="text-sm text-gray-600">Logged in as</div>
              <div className="font-medium text-gray-900 mt-1">{user?.email}</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="text-sm text-gray-600">Role</div>
              <div className="font-medium text-gray-900 mt-1">{isAdmin ? 'Administrator' : 'Viewer'}</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="text-sm text-gray-600">Session</div>
              <div className="font-medium text-green-600 mt-1">Active</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;