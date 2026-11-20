import { useParams } from 'react-router';
import { ListPage } from './ListPage';

export function Component() {
  const { listId = '' } = useParams();
  // A new id starts a fresh page instead of reusing the state of the previous list.
  return <ListPage key={listId} listId={listId} />;
}
