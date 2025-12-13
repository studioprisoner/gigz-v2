export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'super_admin';
  createdAt: string;
}

export function getAdminToken(): string | null {
  return localStorage.getItem('admin-token');
}

export function setAdminToken(token: string) {
  localStorage.setItem('admin-token', token);
}

export function removeAdminToken() {
  localStorage.removeItem('admin-token');
}

export function isAuthenticated(): boolean {
  return !!getAdminToken();
}