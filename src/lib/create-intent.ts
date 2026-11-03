import { useEffect } from 'react';
import { useSearchParams } from 'react-router';

/**
 * Lets the sidebar "+ Create" menu open a page's own existing form: the menu links to
 * `/page?create=kind`, the page opens its form once and then removes the parameter.
 */
export function useCreateIntent(kinds: string | string[], onCreate: (kind: string) => void) {
  const [params, setParams] = useSearchParams();
  const requested = params.get('create');
  const accepted = Array.isArray(kinds) ? kinds : [kinds];
  useEffect(() => {
    if (!requested || !accepted.includes(requested)) return;
    onCreate(requested);
    const next = new URLSearchParams(params);
    next.delete('create');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested]);
}
