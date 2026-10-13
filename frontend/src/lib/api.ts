import type { DatasetInfo, Filters, Liability, Options, Result, Scenario } from "./types";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init);
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      msg = j.detail ?? msg;
    } catch { /* not json */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export interface DatasetResponse { dataset: DatasetInfo; default_liabilities: Liability[]; note: string | null }

export const api = {
  sample: () => call<DatasetResponse>("/datasets/sample", { method: "POST" }),
  ccil: () => call<DatasetResponse>("/datasets/ccil", { method: "POST" }),
  upload: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return call<DatasetResponse>("/datasets/upload", { method: "POST", body: fd });
  },
  parseLiabilities: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return call<{ liabilities: Liability[]; scaled_from_crore: boolean }>("/liabilities/parse", { method: "POST", body: fd });
  },
  optimize: (body: RunBody) => call<Result>("/optimize", json(body)),
  scenario: (body: RunBody & { custom: Record<string, unknown> }) => call<Scenario & { status: string }>("/scenario", json(body)),
  download: async (kind: "xlsx" | "buy-order", body: RunBody) => {
    const res = await fetch(`/api/report/${kind}`, json(body));
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? res.statusText);
    const blob = await res.blob();
    const name = res.headers.get("content-disposition")?.match(/filename="(.+)"/)?.[1] ?? `report.${kind === "xlsx" ? "xlsx" : "csv"}`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  },
};

export interface RunBody { dataset_id: string; liabilities: Liability[]; options: Options; filters: Filters }

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
