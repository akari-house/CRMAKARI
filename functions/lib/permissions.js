export function canViewFinance(auth) {
  return Boolean(auth?.financeAccess || ['OWNER', 'ADMIN', 'FINANCE'].includes(auth?.role));
}

export function requireRole(auth, allowed) {
  if (!auth || !allowed.includes(auth.role)) {
    const error = new Error('You do not have permission to perform this action');
    error.status = 403;
    throw error;
  }
}

export function requireTenant(auth) {
  if (!auth?.tenantId) {
    const error = new Error('No tenant workspace is available for this user');
    error.status = 403;
    throw error;
  }
  return auth.tenantId;
}

