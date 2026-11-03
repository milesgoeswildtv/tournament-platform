import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api';

/** Loads data on mount (and when deps change). Keeps the last good value while reloading. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(() => {
    setLoading(true);
    return fnRef
      .current()
      .then((d) => {
        setData(d);
        setError(null);
        return d;
      })
      .catch((e) => {
        setError(e instanceof ApiError ? e : new ApiError(0, 'error', String(e)));
        return null;
      })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, loading, reload, setData };
}
