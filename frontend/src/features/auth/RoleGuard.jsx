import React from 'react';
import { useRole } from './useRole';

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
