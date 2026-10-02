import { storage } from "@core/lib/storage";
import { SYNC_COLLECTIONS } from "@core/types/sync";
import type {
  ConflictChoice,
  SyncCollection,
  SyncConflict,
  SyncHostInfo,
  SyncIdentity,
  SyncPackage,
  SyncPairingInvite,
  SyncPreview,
  SyncRecord,
} from "@core/types/sync";

export { SYNC_COLLECTIONS } from "@core/types/sync";
export type {
  ConflictChoice,
  SyncCollection,
  SyncConflict,
  SyncHostInfo,
  SyncIdentity,
  SyncPackage,
  SyncPairingInvite,
  SyncPreview,
  SyncRecord,
} from "@core/types/sync";

const DEVICE_ID_KEY = "dunots.device-id";
const DEVICE_NAME_KEY = "dunots.device-name";

function makeDeviceId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "device-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
}

export function makePairingToken() {
  return makeDeviceId();
}

export function encodePairingInvite(host: SyncHostInfo): string {
  const invite: SyncPairingInvite = {
    format: "dunots-pairing",
    version: 1,
    address: host.address,
    token: host.token,
    expiresAt: new Date(host.expires_at * 1000).toISOString(),
  };
  return JSON.stringify(invite);
}

export function parsePairingInvite(value: unknown): SyncPairingInvite {
  if (!value || typeof value !== "object") throw new Error("Convite de pareamento inválido.");
  const raw = value as Partial<SyncPairingInvite>;
  const isLegacy = raw.format === undefined && raw.version === undefined;
  if ((!isLegacy && (raw.format !== "dunots-pairing" || raw.version !== 1)) || typeof raw.address !== "string" || typeof raw.token !== "string" || typeof raw.expiresAt !== "string") {
    throw new Error("Este QR Code não contém um convite Dunots compatível.");
  }
  const expiresAt = Date.parse(raw.expiresAt);
  if (!/^https?:\/\//i.test(raw.address) || !raw.token.trim() || Number.isNaN(expiresAt) || expiresAt <= Date.now()) {
    throw new Error("O convite de pareamento está incompleto ou expirado.");
  }
  return {
    format: "dunots-pairing",
    version: 1,
    address: raw.address,
    token: raw.token,
    expiresAt: raw.expiresAt,
  };
}

export function getDeviceIdentity(): SyncIdentity {
  if (typeof window === "undefined") return { deviceId: "server", deviceName: "Dunots" };
  let deviceId = window.localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = makeDeviceId();
    window.localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  const storedName = window.localStorage.getItem(DEVICE_NAME_KEY);
  return { deviceId, deviceName: storedName?.trim() || "Meu notebook" };
}

export function saveDeviceName(deviceName: string) {
  const cleaned = deviceName.trim().slice(0, 60) || "Meu notebook";
  window.localStorage.setItem(DEVICE_NAME_KEY, cleaned);
  return cleaned;
}

function emptyCollections(): Record<SyncCollection, SyncRecord[]> {
  return Object.fromEntries(SYNC_COLLECTIONS.map((collection) => [collection, []])) as unknown as Record<SyncCollection, SyncRecord[]>;
}

export async function createSyncPackage(source: SyncIdentity): Promise<SyncPackage> {
  const collections = emptyCollections();
  for (const collection of SYNC_COLLECTIONS) {
    collections[collection] = await storage.list<SyncRecord>(collection);
  }
  return { format: "dunots-sync", version: 1, exportedAt: new Date().toISOString(), source, collections };
}

export function parseSyncPackage(value: unknown): SyncPackage {
  if (!value || typeof value !== "object") throw new Error("O arquivo não contém um pacote válido.");
  const raw = value as Partial<SyncPackage>;
  if (raw.format !== "dunots-sync" || raw.version !== 1 || !raw.collections || typeof raw.collections !== "object") {
    throw new Error("Este arquivo não é um pacote de sincronização do Dunots.");
  }
  const collections = emptyCollections();
  for (const collection of SYNC_COLLECTIONS) {
    const records = (raw.collections as Partial<Record<SyncCollection, unknown>>)[collection];
    if (records === undefined) continue;
    if (!Array.isArray(records)) throw new Error("A coleção " + collection + " está inválida.");
    collections[collection] = records.filter((record): record is SyncRecord => Boolean(record && typeof record === "object" && typeof (record as { id?: unknown }).id === "string"));
  }
  const source = raw.source && typeof raw.source === "object" ? raw.source as SyncIdentity : { deviceId: "unknown", deviceName: "Dispositivo desconhecido" };
  return {
    format: "dunots-sync",
    version: 1,
    exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : new Date().toISOString(),
    source: { deviceId: String(source.deviceId || "unknown"), deviceName: String(source.deviceName || "Dispositivo desconhecido") },
    collections,
  };
}

function recordTime(record?: SyncRecord) {
  return record?.deletedAt ?? record?.updatedAt ?? record?.createdAt ?? "";
}

function sameRecord(left: SyncRecord, right: SyncRecord) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function conflictKey(collection: SyncCollection, id: string) {
  return collection + ":" + id;
}

function tombstoneKey(tombstone: SyncRecord) {
  return conflictKey(String(tombstone.collection) as SyncCollection, String(tombstone.recordId));
}

export function previewSyncPackage(local: Record<SyncCollection, SyncRecord[]>, incoming: SyncPackage): SyncPreview {
  const conflictRecords: SyncConflict[] = [];
  const byCollection = SYNC_COLLECTIONS.filter((collection) => collection !== "sync_tombstones").map((collection) => {
    const localById = new Map(local[collection].map((record) => [record.id, record]));
    let added = 0;
    let updated = 0;
    let unchanged = 0;
    let conflicts = 0;
    for (const record of incoming.collections[collection]) {
      const existing = localById.get(record.id);
      const localTombstone = (local.sync_tombstones ?? []).find((tombstone) => tombstoneKey(tombstone) === conflictKey(collection, record.id));
      if (localTombstone && recordTime(localTombstone) >= recordTime(record)) continue;
      if (!existing) {
        added++;
        continue;
      }
      if (sameRecord(existing, record)) {
        unchanged++;
        continue;
      }
      updated++;
      conflicts++;
      conflictRecords.push({ key: conflictKey(collection, record.id), collection, id: record.id, local: existing, incoming: record, localUpdatedAt: recordTime(existing), incomingUpdatedAt: recordTime(record) });
    }
    for (const tombstone of incoming.collections.sync_tombstones) {
    if (typeof tombstone.collection !== "string" || tombstone.collection === "sync_tombstones" || typeof tombstone.recordId !== "string") continue;
      if (tombstone.collection !== collection || typeof tombstone.recordId !== "string") continue;
      const existing = localById.get(tombstone.recordId);
      const localTombstone = (local.sync_tombstones ?? []).find((item) => tombstoneKey(item) === tombstoneKey(tombstone));
      if (localTombstone && recordTime(localTombstone) >= recordTime(tombstone)) continue;
      if (existing && recordTime(existing) > recordTime(tombstone)) {
        conflicts++;
        conflictRecords.push({ key: conflictKey(collection, tombstone.recordId), collection, id: tombstone.recordId, local: existing, incoming: tombstone, localUpdatedAt: recordTime(existing), incomingUpdatedAt: recordTime(tombstone) });
      }
    }
    return { collection, added, updated, deleted: incoming.collections.sync_tombstones.filter((tombstone) => tombstone.collection === collection && typeof tombstone.recordId === "string" && localById.has(tombstone.recordId)).length, unchanged, conflicts };
  });
  const deleted = byCollection.reduce((total, item) => total + item.deleted, 0);
  const added = byCollection.reduce((total, item) => total + item.added, 0);
  const updated = byCollection.reduce((total, item) => total + item.updated, 0);
  const unchanged = byCollection.reduce((total, item) => total + item.unchanged, 0);
  return { added, updated, deleted, unchanged, conflicts: conflictRecords.length, conflictRecords, byCollection: [...byCollection, { collection: "sync_tombstones", added: incoming.collections.sync_tombstones.length, updated: 0, deleted: 0, unchanged: 0, conflicts: 0 }] };
}

export async function readLocalSyncData() {
  const collections = emptyCollections();
  for (const collection of SYNC_COLLECTIONS) {
    collections[collection] = await storage.list<SyncRecord>(collection);
  }
  return collections;
}

export async function applySyncPackage(incoming: SyncPackage, resolutions: Record<string, ConflictChoice> = {}) {
  const local = await readLocalSyncData();
  const preview = previewSyncPackage(local, incoming);
  const conflicts = new Map(preview.conflictRecords.map((conflict) => [conflict.key, conflict]));
  for (const collection of SYNC_COLLECTIONS.filter((item) => item !== "sync_tombstones")) {
    for (const record of incoming.collections[collection]) {
      const key = conflictKey(collection, record.id);
      const conflict = conflicts.get(key);
      if (conflict && (resolutions[key] ?? "local") !== "incoming") continue;
      const localTombstone = (local.sync_tombstones ?? []).find((tombstone) => tombstoneKey(tombstone) === key);
      if (localTombstone && recordTime(localTombstone) >= recordTime(record)) continue;
      await storage.remove("sync_tombstones", key);
      await storage.put(collection, record);
    }
  }
  for (const tombstone of incoming.collections.sync_tombstones) {
    if (typeof tombstone.collection !== "string" || tombstone.collection === "sync_tombstones" || typeof tombstone.recordId !== "string") continue;
    const key = tombstoneKey(tombstone);
    const conflict = conflicts.get(key);
    if (conflict && (resolutions[key] ?? "local") !== "incoming") continue;
    const localRecord = local[tombstone.collection as SyncCollection]?.find((record) => record.id === tombstone.recordId);
    const localTombstone = (local.sync_tombstones ?? []).find((item) => tombstoneKey(item) === key);
    if (localTombstone && recordTime(localTombstone) >= recordTime(tombstone)) continue;
    if (localRecord) await storage.remove(tombstone.collection as SyncCollection, tombstone.recordId);
    await storage.put("sync_tombstones", tombstone);
  }
  return preview;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function encryptionKey(secret: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSyncPackage(syncPackage: SyncPackage, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(secret), new TextEncoder().encode(JSON.stringify(syncPackage)));
  return JSON.stringify({ format: "dunots-sync-encrypted", version: 1, iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(encrypted)) });
}

export async function decryptSyncPayload(payload: string, secret: string): Promise<unknown> {
  const envelope = JSON.parse(payload) as { format?: string; version?: number; iv?: string; data?: string };
  if (envelope.format !== "dunots-sync-encrypted" || envelope.version !== 1 || !envelope.iv || !envelope.data) throw new Error("O transporte não contém um pacote criptografado válido.");
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(envelope.iv) }, await encryptionKey(secret), base64ToBytes(envelope.data));
  return JSON.parse(new TextDecoder().decode(decrypted));
}

export function downloadSyncPackage(syncPackage: SyncPackage) {
  const blob = new Blob([JSON.stringify(syncPackage, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "dunots-sync-" + new Date().toISOString().slice(0, 10) + ".dunots";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
