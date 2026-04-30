export interface FileSnapshotMetadata {
  readonly mtimeMs: number;
  readonly size: number;
}

export function shouldReloadFileByMtime(fileMtimeMs: number, lastReadMtimeMs: number | undefined): boolean {
  return lastReadMtimeMs === undefined || fileMtimeMs > lastReadMtimeMs;
}

export function isStableFileSnapshot(before: FileSnapshotMetadata, after: FileSnapshotMetadata): boolean {
  return before.mtimeMs === after.mtimeMs && before.size === after.size;
}
