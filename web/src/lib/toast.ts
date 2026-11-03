import { useSyncExternalStore } from 'react';

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error' | 'good';
}

let items: Toast[] = [];
let n = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function toast(text: string, tone: Toast['tone'] = 'info', ms = 3200) {
  const id = ++n;
  items = [...items.filter((t) => t.text !== text), { id, text, tone }].slice(-3);
  emit();
  window.setTimeout(() => dismiss(id), ms);
}

export function dismiss(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => items,
  );
}
