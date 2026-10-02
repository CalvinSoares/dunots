/**
 * Contrato compartilhado do pacote de sincronização Dunots.
 *
 * Os modelos de domínio continuam pertencendo a cada plataforma. Este arquivo
 * descreve somente o formato estável usado no transporte entre desktop/web e
 * clientes futuros, como o mobile.
 */
export const SYNC_COLLECTIONS = [
  "flashcards",
  "leetcode_problems",
  "challenge_reviews",
  "articles",
  "snippets",
  "study_phases",
  "diagrams",
  "quiz_exams",
  "quiz_questions",
  "quiz_attempts",
  "study_roadmaps",
  "roadmap_nodes",
  "roadmap_links",
  "sync_tombstones",
] as const;

export type SyncCollection = typeof SYNC_COLLECTIONS[number];
export type ConflictChoice = "local" | "incoming";

export interface SyncTombstone {
  id: string;
  collection: string;
  recordId: string;
  deletedAt: string;
  updatedAt: string;
}

/** Registro extensível: cada plataforma pode manter campos adicionais. */
export type SyncRecord = {
  id: string;
  updatedAt?: string;
  createdAt?: string;
  deletedAt?: string;
  collection?: string;
  recordId?: string;
  [key: string]: unknown;
};

export interface SyncIdentity {
  deviceId: string;
  deviceName: string;
}

export interface SyncHostInfo {
  address: string;
  token: string;
  expires_at: number;
}

export interface SyncPairingInvite {
  format: "dunots-pairing";
  version: 1;
  address: string;
  token: string;
  expiresAt: string;
}

export interface SyncPackage {
  format: "dunots-sync";
  version: 1;
  exportedAt: string;
  source: SyncIdentity;
  collections: Record<SyncCollection, SyncRecord[]>;
}

export interface SyncConflict {
  key: string;
  collection: SyncCollection;
  id: string;
  local?: SyncRecord;
  incoming?: SyncRecord;
  localUpdatedAt?: string;
  incomingUpdatedAt?: string;
}

export interface SyncPreview {
  added: number;
  updated: number;
  deleted: number;
  unchanged: number;
  conflicts: number;
  conflictRecords: SyncConflict[];
  byCollection: Array<{
    collection: SyncCollection;
    added: number;
    updated: number;
    deleted: number;
    unchanged: number;
    conflicts: number;
  }>;
}
