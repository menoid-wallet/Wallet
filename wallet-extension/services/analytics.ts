/**
 * analytics.ts — the extension half of our own product analytics.
 *
 * Mirrors wallet-app/src/services/analytics.ts: same event names, same
 * endpoints, same rules. The names MUST stay in step with the app's or the two
 * platforms cannot be compared, which is half the point of collecting this.
 *
 * WHY NOT GOOGLE ANALYTICS HERE. Beyond the obvious — a privacy wallet should
 * not report to an ad company — gtag.js simply does not work under Manifest V3:
 * remote scripts are forbidden by the extension CSP and a service worker has no
 * DOM to attach a tag to. Talking to our own backend over plain fetch sidesteps
 * that entirely.
 *
 * THE RULES, identical to the app's and equally non-negotiable: no seeds, no
 * keys, no commitments, no randomness, no nullifiers, no addresses, no hashes,
 * no exact amounts on private flows. Private flows report counts and durations.
 * `scrub()` enforces it centrally rather than trusting call sites.
 */

import { BASE_URL } from "./api";

const INSTALL_KEY = "menoid_install_id_v1";
const QUEUE_KEY = "menoid_analytics_queue_v1";
const OPTOUT_KEY = "menoid_analytics_optout_v1";

const FLUSH_MS = 15_000;
const MAX_BATCH = 50;
const MAX_QUEUE = 500;

export interface TrackProps {
  network?: string;
  status?: "success" | "failure" | "cancelled";
  durationMs?: number;
  batchCount?: number;
  batchSizes?: number[];
  proofMs?: number;
  errorKind?: string;
  props?: Record<string, unknown>;
}

interface QueuedEvent extends TrackProps {
  name: string;
  occurredAt: string;
}

let installId: string | null = null;
let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let optedOut = false;
let appVersion = "0.0.1";

async function get<T>(key: string): Promise<T | null> {
  try {
    const r = await chrome.storage.local.get(key);
    return (r?.[key] as T) ?? null;
  } catch {
    return null;
  }
}

async function set(key: string, value: unknown): Promise<void> {
  try {
    await chrome.storage.local.set({ [key]: value });
  } catch {
    /* ignore — a lost analytics write must never surface */
  }
}

function randomId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Random per-installation id. Never derived from the device or the wallet. */
async function getInstallId(): Promise<string> {
  if (installId) return installId;
  const stored = await get<string>(INSTALL_KEY);
  if (stored) {
    installId = stored;
    return stored;
  }
  const fresh = randomId();
  installId = fresh;
  await set(INSTALL_KEY, fresh);
  return fresh;
}

const BANNED = [
  "seed", "mnemonic", "phrase", "privatekey", "privkey", "secret", "sk",
  "commitment", "randomness", "nullifier", "note",
  "address", "recipient", "to", "from", "txhash", "hash", "signature",
  "amount", "value", "balance",
];

function scrub(props?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!props) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    const key = k.toLowerCase();
    if (BANNED.some((bad) => key === bad || key.endsWith(bad))) continue;
    if (typeof v === "string" && v.length > 200) continue;
    out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Fire-and-forget. Never awaited, never throws. */
export function track(name: string, p: TrackProps = {}): void {
  if (optedOut) return;
  queue.push({ ...p, props: scrub(p.props), name, occurredAt: new Date().toISOString() });
  if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
  if (queue.length >= MAX_BATCH) void flush();
}

export async function flush(): Promise<void> {
  if (optedOut || queue.length === 0) return;
  const batch = queue.slice(0, MAX_BATCH);
  queue = queue.slice(batch.length);

  try {
    const id = await getInstallId();
    const res = await fetch(`${BASE_URL}/analytics/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ installId: id, platform: "extension", appVersion, events: batch }),
    });
    if (!res.ok) throw new Error(String(res.status));
    await set(QUEUE_KEY, queue);
  } catch {
    queue = [...batch, ...queue].slice(-MAX_QUEUE);
    void set(QUEUE_KEY, queue);
  }
}

/**
 * Call once when the popup opens. Idempotent server-side, so reporting on every
 * open is correct and means a single failed call never loses the install.
 */
export async function initAnalytics(opts: { appVersion?: string } = {}): Promise<void> {
  appVersion = opts.appVersion ?? appVersion;
  optedOut = (await get<boolean>(OPTOUT_KEY)) === true;
  if (optedOut) return;

  const stored = await get<QueuedEvent[]>(QUEUE_KEY);
  if (Array.isArray(stored) && stored.length) queue = stored.slice(-MAX_QUEUE);

  const id = await getInstallId();
  try {
    await fetch(`${BASE_URL}/analytics/install`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        installId: id,
        platform: "extension",
        appVersion,
        osVersion: navigator.userAgent.slice(0, 40),
        locale: navigator.language,
      }),
    });
  } catch {
    /* try again next open */
  }

  if (!timer) timer = setInterval(() => void flush(), FLUSH_MS);
  void flush();
}

export async function setAnalyticsOptOut(off: boolean): Promise<void> {
  optedOut = off;
  await set(OPTOUT_KEY, off);
  if (off) {
    queue = [];
    await set(QUEUE_KEY, []);
  }
}

export async function isAnalyticsOptedOut(): Promise<boolean> {
  return (await get<boolean>(OPTOUT_KEY)) === true;
}
