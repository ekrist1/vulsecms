export interface RevisionDTO {
  id: string;
  entryId: string;
  revisionNumber: number;
  content: Record<string, unknown>;
  createdAt: string;
  createdBy: string | null;
}

export interface RevisionSummary {
  id: string;
  entryId: string;
  revisionNumber: number;
  createdAt: string;
  createdBy: string | null;
}

export interface MutationContext {
  actor?: { userId: string } | null;
}
