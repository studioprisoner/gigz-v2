import { createFileRoute } from '@tanstack/react-router';
import { ConcertsPage } from '../../pages/ConcertsPage';

export const Route = createFileRoute('/_authenticated/concerts')({
  component: ConcertsPage,
});