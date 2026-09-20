"use client";

const CACHE_PREFIX = "manifest:cache:";
const QUEUE_KEY = "manifest:queue";

export function cacheSet(table: string, rows: unknown[]) {
  try {
    localStorage.setItem(CACHE_PREFIX + table, JSON.stringify({ rows, savedAt: Date.now() }));
  } catch {}
}

export function cacheGet<T = any>(table: string): { rows: T[]; savedAt: number } | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + table);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export interface QueuedMutation {
  id: string;
  table: string;
  type: "insert" | "update" | "delete";
  payload: any;
  match?: Record<string, any>;
  queuedAt: number;
}

function readQueue(): QueuedMutation[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedMutation[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {}
}

export function enqueueMutation(m: Omit<QueuedMutation, "id" | "queuedAt">) {
  const queue = readQueue();
  queue.push({ ...m, id: crypto.randomUUID(), queuedAt: Date.now() });
  writeQueue(queue);
}

export function pendingCount(): number {
  return readQueue().length;
}

export async function flushQueue(supabase: any) {
  const queue = readQueue();
  if (!queue.length) return { flushed: 0, failed: 0 };

  let flushed = 0;
  let failed = 0;
  const remaining: QueuedMutation[] = [];

  for (const m of queue) {
    try {
      if (m.type === "insert") {
        const { error } = await supabase.from(m.table).insert(m.payload);
        if (error) throw error;
      } else if (m.type === "update") {
        let q = supabase.from(m.table).update(m.payload);
        for (const [k, v] of Object.entries(m.match || {})) q = q.eq(k, v);
        const { error } = await q;
        if (error) throw error;
      } else if (m.type === "delete") {
        let q = supabase.from(m.table).delete();
        for (const [k, v] of Object.entries(m.match || {})) q = q.eq(k, v);
        const { error } = await q;
        if (error) throw error;
      }
      flushed++;
    } catch {
      failed++;
      remaining.push(m);
    }
  }

  writeQueue(remaining);
  return { flushed, failed };
}

export function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}
