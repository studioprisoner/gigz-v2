import { createFileRoute, redirect } from '@tanstack/react-router';
import { LoginPage } from '../pages/LoginPage';
import { isAuthenticated } from '../lib/auth';

export const Route = createFileRoute('/login')({
  beforeLoad: () => {
    if (isAuthenticated()) {
      throw redirect({
        to: '/dashboard',
      });
    }
  },
  component: LoginPage,
});