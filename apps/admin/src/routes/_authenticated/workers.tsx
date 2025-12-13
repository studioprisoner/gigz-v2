import { createFileRoute } from '@tanstack/react-router';
import { WorkersPage } from '../../pages/WorkersPage';

export const Route = createFileRoute('/_authenticated/workers')({
  component: WorkersPage,
});