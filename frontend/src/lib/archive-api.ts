"use client";

import { API_BASE } from "./api";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("srp_jwt_token");
}

function buildHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getToken();
  const headers: Record<string, string> = extra ?? {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

/** Archive task entry — mirrors backend TaskArchiveEntry */
export interface ArchiveCommand {
  action: string;
  task: string;
}

export interface ArchiveObservation {
  timestamp: number;
  observation: string;
}

export interface ArchiveExecution {
  status: "done" | "failed";
  result?: string;
  errors?: string[];
  started_at?: string;
  finished_at?: string;
  deviations?: string[];
}

export interface ArchiveEntry {
  id: string;
  task_id: string;
  session_id: string;
  turn_id: number;
  command: ArchiveCommand;
  user_input: string;
  constraints: string[];
  status: "pending" | "running" | "done" | "failed" | "cancelled";
  observations: ArchiveObservation[];
  execution?: ArchiveExecution;
  created_at: string;
  updated_at?: string;
}

// ── Archive API helpers ──────────────────────────────────────────────────────

export async function fetchArchivesBySession(
  sessionId: string,
  userId: string,
  limit = 50
): Promise<{ entries: ArchiveEntry[]; count: number }> {
  const res = await fetch(
    `${API_BASE}/v1/archive/tasks?session_id=${encodeURIComponent(sessionId)}&limit=${limit}`,
    { headers: { "X-User-Id": userId, ...buildHeaders() } }
  );
  if (!res.ok) throw new Error(`加载档案列表失败 (${res.status})`);
  return res.json() as Promise<{ entries: ArchiveEntry[]; count: number }>;
}

export async function fetchArchiveById(id: string, userId: string): Promise<ArchiveEntry> {
  const res = await fetch(`${API_BASE}/v1/archive/tasks/${encodeURIComponent(id)}`, {
    headers: { "X-User-Id": userId, ...buildHeaders() },
  });
  if (!res.ok) throw new Error(`加载档案详情失败 (${res.status})`);
  return res.json() as Promise<ArchiveEntry>;
}

export async function deleteArchive(id: string, userId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/archive/tasks/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "X-User-Id": userId, ...buildHeaders() },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error ?? `删除档案失败 (${res.status})`);
  }
}

export async function updateArchiveStatus(
  id: string,
  userId: string,
  status: ArchiveEntry["status"]
): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/archive/tasks/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "X-User-Id": userId, ...buildHeaders() },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(`更新档案状态失败 (${res.status})`);
}
