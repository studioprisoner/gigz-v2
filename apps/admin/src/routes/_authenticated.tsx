import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { AdminLayout } from '../components/AdminLayout';
import { isAuthenticated } from '../lib/auth';

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: () => {
    if (!isAuthenticated()) {
      throw redirect({
        to: '/login',
      });
    }
  },
  component: () => (
    <AdminLayout>
      <Outlet />
    </AdminLayout>
  ),
});