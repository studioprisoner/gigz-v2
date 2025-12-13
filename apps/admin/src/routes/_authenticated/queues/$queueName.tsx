import { createFileRoute } from '@tanstack/react-router';
import { QueueDetailPage } from '../../../pages/QueueDetailPage';

export const Route = createFileRoute('/_authenticated/queues/$queueName')({
  component: QueueDetailPage,
});