"use client";

// useState that survives reloads: the value is kept in this browser's localStorage.
// The first render uses `initial` (matches the server render), then the stored value
// is loaded; nothing is written until that load has happened, so a stored value is
// never overwritten by the default.
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

const PREFIX = "ust-monitor:";

export function usePersisted<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>, boolean] {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  const fullKey = PREFIX + key;
  const first = useRef(true);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(fullKey);
      if (raw != null) setValue(JSON.parse(raw) as T);
    } catch {
      // storage blocked or bad JSON: keep the default
    }
    setLoaded(true);
  }, [fullKey]);

  useEffect(() => {
    if (!loaded) return;
    if (first.current) { first.current = false; return; } // skip echoing the value we just loaded
    try {
      localStorage.setItem(fullKey, JSON.stringify(value));
    } catch {
      // storage unavailable: setting lasts for this page view only
    }
  }, [fullKey, value, loaded]);

  return [value, setValue, loaded];
}
