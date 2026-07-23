"use client";

import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { 
  onAuthStateChanged, 
  signInWithPopup,
  GoogleAuthProvider,
  signOut as firebaseSignOut 
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/firebase/config';
import { isAllowedDomain, deriveAuthorization, derivePermissionFlags } from '@/utils/authzLogic.mjs';

const AuthContext = createContext({});

export const useAuth = () => useContext(AuthContext);


export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [permissions, setPermissions] = useState(null);
  const [loading, setLoading] = useState(true);
  const isSigningIn = useRef(false);

  const checkAdminStatus = async (email) => {
    if (!email) return false;

    try {
      const adminDoc = await getDoc(doc(db, 'admins', email.toLowerCase()));
      return adminDoc.exists();
    } catch (error) {
      console.error('Error checking admin status:', error);
      return false;
    }
  };

  // Elevated, non-full-admin access flags (partial admin, downloads-only,
  // transactions+ops-only dashboards) — read from permissions/{email}
  // instead of the hardcoded email allowlists that used to live in
  // src/utils/{partialAdminAccess,downloadsAccess,transactionsOpsAccess}.js.
  // See SEC-016 in the security audit; firestore.rules enforces the same
  // flags server-side via isPartialAdmin() / hasDownloadsAccess() /
  // hasTransactionsOpsAccess().
  const checkPermissions = async (email) => {
    if (!email) return null;

    try {
      const permissionsDoc = await getDoc(doc(db, 'permissions', email.toLowerCase()));
      return permissionsDoc.exists() ? permissionsDoc.data() : null;
    } catch (error) {
      console.error('Error checking permissions:', error);
      return null;
    }
  };

  // Check if user is authorized (either from allowed domain or is an admin).
  // The fetch results are combined by the pure deriveAuthorization helper
  // (src/utils/authzLogic.mjs).
  const checkAuthorization = async (email) => {
    if (!email) return deriveAuthorization(null);

    const [adminStatus, permissionsData] = await Promise.all([
      checkAdminStatus(email),
      checkPermissions(email),
    ]);

    return deriveAuthorization(email, { adminDocExists: adminStatus, permissionsDoc: permissionsData });
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      // Skip state updates while actively signing in to prevent interruption
      if (isSigningIn.current) {
        return;
      }

      setUser(firebaseUser);

      if (firebaseUser && !firebaseUser.isAnonymous) {
        const { isAuthorized: authorized, isAdmin: admin, permissions: perms } = await checkAuthorization(firebaseUser.email);
        setIsAuthorized(authorized);
        setIsAdmin(admin);
        setPermissions(perms);
      } else {
        setIsAuthorized(false);
        setIsAdmin(false);
        setPermissions(null);
      }

      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    try {
      isSigningIn.current = true;
      const provider = new GoogleAuthProvider();
      // Force account selection every time
      provider.setCustomParameters({
        prompt: 'select_account'
      });
      
      const result = await signInWithPopup(auth, provider);

      const { isAuthorized: authorized, isAdmin: admin, permissions: perms } = await checkAuthorization(result.user.email);

      // Now update state after sign-in is complete
      setUser(result.user);
      setIsAuthorized(authorized);
      setIsAdmin(admin);
      setPermissions(perms);
      isSigningIn.current = false;
      
      return { 
        success: true, 
        user: result.user,
        isAuthorized: authorized,
        isAdmin: admin
      };
    } catch (error) {
      isSigningIn.current = false;
      console.error('Google sign-in error:', error);
      
      // Handle specific error cases
      if (error.code === 'auth/popup-closed-by-user') {
        return { success: false, error: 'Sign-in cancelled' };
      }
      if (error.code === 'auth/popup-blocked') {
        return { success: false, error: 'Popup was blocked. Please allow popups for this site.' };
      }
      
      return { success: false, error: error.message };
    }
  };

  const signOut = async () => {
    try {
      await firebaseSignOut(auth);
      setUser(null);
      setIsAuthorized(false);
      setIsAdmin(false);
      setPermissions(null);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  };

  // Current user's email (lowercased for comparison)
  const userEmail = user?.email ? user.email.toLowerCase() : null;

  // Restricted-mode flags (partial admin, downloads-only, transactions+ops-only)
  const permissionFlags = derivePermissionFlags(permissions);

  return (
    <AuthContext.Provider value={{
      user,
      isAdmin,
      isPartialAdmin: permissionFlags.isPartialAdmin,
      hasDownloadsAccess: permissionFlags.hasDownloadsAccess,
      hasTransactionsOpsAccess: permissionFlags.hasTransactionsOpsAccess,
      isAuthorized,
      loading,
      signInWithGoogle,
      signOut,
      isAllowedDomain,
      userEmail,
    }}>
      {children}
    </AuthContext.Provider>
  );
};