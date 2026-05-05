import React from 'react';
import { useAuthStore } from '../../store/authStore';

export const useRole = () => {
  const user = useAuthStore(state => state.user);
  return user?.role || 'viewer';
};

export const RoleGuard = ({ allowedRoles, children, fallback = null }) => {
  const currentRole = useRole();
  
  // super_admin always has access
  if (currentRole === 'super_admin') {
    return <>{children}</>;
  }
  
  if (allowedRoles.includes(currentRole)) {
    return <>{children}</>;
  }
  
  return <>{fallback}</>;
};
