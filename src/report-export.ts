export type ReportExportSnapshot = {
  record: object;
  revision: number;
  report: object;
  reportJson: string;
};

/** Protect the response boundary from a case changing while its PDF is being rendered. */
export function reportExportSnapshotMatches(snapshot: ReportExportSnapshot, candidate: unknown): boolean {
  if (candidate !== snapshot.record || candidate === null || typeof candidate !== 'object') return false;
  const current = candidate as { revision?: unknown; status?: unknown; report?: unknown };
  if (current.revision !== snapshot.revision || current.status !== 'completed' || current.report !== snapshot.report) return false;
  try { return JSON.stringify(current.report) === snapshot.reportJson; }
  catch { return false; }
}
