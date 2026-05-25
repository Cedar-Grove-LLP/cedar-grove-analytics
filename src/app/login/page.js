"use client";

import { Suspense, useMemo, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

// Separate component that uses useSearchParams
function LoginContent() {
  const { user, isAdmin, isAuthorized, loading, signInWithGoogle, signOut } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawReturnUrl = searchParams.get('returnUrl') || '/';
  // SEC-009: validate returnUrl as same-origin before passing to router.push.
  // Cross-origin, protocol-relative (//evil), backslash-trick (/\evil), and
  // non-http(s) schemes (javascript:) all collapse to '/'. `new URL(...,
  // window.location.origin)` is the canonicalization; the post-parse origin
  // compare is the authoritative gate, with the prefix re-check as
  // defense-in-depth against edge cases that survive URL parsing.
  const returnUrl = useMemo(() => {
    if (typeof window === 'undefined') return '/';

    const candidate = rawReturnUrl.trim() || '/';

    try {
      const url = new URL(candidate, window.location.origin);

      if (url.origin !== window.location.origin) return '/';

      const safe = url.pathname + url.search + url.hash;

      if (
        !safe.startsWith('/') ||
        safe.startsWith('//') ||
        safe.includes('\\')
      ) {
        return '/';
      }

      return safe || '/';
    } catch {
      return '/';
    }
  }, [rawReturnUrl]);
  const errorParam = searchParams.get('error');

  // Initialize error from URL params
  const getInitialError = () => {
    if (errorParam === 'admin_required') return 'Admin access is required for this page.';
    if (errorParam === 'access_denied') return 'You do not have access to that page.';
    return null;
  };

  const [error, setError] = useState(getInitialError);
  const [signingIn, setSigningIn] = useState(false);

  // Redirect if already authenticated and authorized
  useEffect(() => {
    if (!loading && user && !user.isAnonymous && isAuthorized) {
      router.push(returnUrl);
    }
  }, [user, isAuthorized, loading, router, returnUrl]);

  const handleGoogleSignIn = async () => {
    try {
      setSigningIn(true);
      setError(null);
      const result = await signInWithGoogle();
      
      if (!result.success) {
        if (result.error !== 'Sign-in cancelled') {
          setError(result.error || 'Failed to sign in. Please try again.');
        }
        setSigningIn(false);
        return;
      }
      
      // If sign-in succeeded and user is authorized, redirect will happen via useEffect
      if (result.isAuthorized) {
        router.push(returnUrl);
      }
      setSigningIn(false);
    } catch (err) {
      console.error('Sign in error:', err);
      setError('Failed to sign in. Please try again.');
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    setError(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <div className="mt-4 text-xl text-gray-700">Loading...</div>
        </div>
      </div>
    );
  }

  // User is logged in but not authorized (not from allowed domain and not an admin)
  if (user && !user.isAnonymous && !isAuthorized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h2>
          <p className="text-gray-600 mb-4">
            Your account ({user.email}) is not authorized to access this site.
          </p>
          <p className="text-sm text-gray-500 mb-6">
            Access is restricted to @cedargrovellp.com email addresses or authorized administrators.
          </p>
          <button
            onClick={handleSignOut}
            className="w-full px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            Sign out and try another account
          </button>
        </div>
      </div>
    );
  }

  // Not logged in (or anonymous) - show sign in form
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Cedar Grove Analytics</h1>
          <p className="text-gray-600 mt-2">Sign in to continue</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}

        <button
          onClick={handleGoogleSignIn}
          disabled={signingIn}
          className={`w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-300 rounded-lg transition-colors ${
            signingIn
              ? 'bg-gray-100 cursor-not-allowed'
              : 'bg-white hover:bg-gray-50'
          }`}
        >
          {signingIn ? (
            <>
              <div className="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
              <span className="text-gray-600">Signing in...</span>
            </>
          ) : (
            <>
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              <span className="text-gray-700 font-medium">Sign in with Google</span>
            </>
          )}
        </button>

      </div>
    </div>
  );
}

// Loading fallback for Suspense
function LoginLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        <div className="mt-4 text-xl text-gray-700">Loading...</div>
      </div>
    </div>
  );
}

// Main page component with Suspense wrapper
export default function LoginPage() {
  return (
    <Suspense fallback={<LoginLoading />}>
      <LoginContent />
    </Suspense>
  );
}