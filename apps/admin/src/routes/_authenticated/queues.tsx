import { createFileRoute } from '@tanstack/react-router';
import { QueuesPage } from '../../pages/QueuesPage';

export const Route = createFileRoute('/_authenticated/queues')({
  component: QueuesPage,
});