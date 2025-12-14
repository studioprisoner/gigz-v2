import { createFileRoute } from '@tanstack/react-router';
import { UserDetailPage } from '../../pages/UserDetailPage';

export const Route = createFileRoute('/_authenticated/users/$userId')({
  component: UserDetailPage,
});