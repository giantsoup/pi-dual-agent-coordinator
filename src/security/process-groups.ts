import { execFileSync } from "node:child_process";

type ProcessRow = { pid: number; parent: number; group: number; identity: string };
function processTable(): ProcessRow[] {
  const text = execFileSync("/bin/ps", ["-axo", "pid=,ppid=,pgid=,stat=,lstart="], { encoding: "utf8", timeout: 2_000 });
  const rows: ProcessRow[] = [];
  for (const line of text.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/.exec(line);
    if (match?.[1] && match[2] && match[3] && match[4] && match[5] && !match[4].startsWith("Z")) rows.push({ pid: Number(match[1]), parent: Number(match[2]), group: Number(match[3]), identity: `${match[1]}:${match[5]}` });
  }
  return rows;
}
export function groupIdentities(rows = processTable()): Map<number, Set<string>> {
  const groups = new Map<number, Set<string>>();
  for (const row of rows) { const identities = groups.get(row.group) ?? new Set<string>(); identities.add(row.identity); groups.set(row.group, identities); }
  return groups;
}
export function processGroups(root: number, rootIdentity: Set<string> | undefined): Map<number, Set<string>> {
  const rows = processTable();
  if (!rows.some(row => row.pid === root && rootIdentity?.has(row.identity))) return new Map();
  const children = new Map<number, ProcessRow[]>();
  for (const row of rows) { const list = children.get(row.parent) ?? []; list.push(row); children.set(row.parent, list); }
  const owned: ProcessRow[] = [], queue = [root], seen = new Set<number>();
  for (let index = 0; index < queue.length; index++) {
    const parent = queue[index]; if (parent === undefined || seen.has(parent)) continue;
    seen.add(parent);
    for (const child of children.get(parent) ?? []) { owned.push(child); queue.push(child.pid); }
  }
  return groupIdentities(owned);
}

export function signalGroup(group: number, signal: NodeJS.Signals): void {
  try { process.kill(-group, signal); }
  catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ESRCH" || error.code === "EPERM" && !groupIdentities().has(group))) return;
    throw error;
  }
}

