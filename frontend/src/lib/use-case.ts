import { useEffect, useState } from 'react';
import { CaseClient } from './case-client.ts';
export function useCase() {
  const [client] = useState(() => new CaseClient());
  const [state, setState] = useState(client.state);
  useEffect(() => { const unsubscribe = client.subscribe(setState); void client.open(); return () => { unsubscribe(); client.dispose(); }; }, [client]);
  return { state, client };
}
