export type RevisionKind = 'draft' | 'publish';

export interface RevisionSummary {
  id: string;
  entryId: string;
  revisionNumber: number;
  kind: RevisionKind;
  createdAt: string;
  createdBy: string | null;
}

export interface RevisionDTO extends RevisionSummary {
  content: Record<string, unknown>;
}

export interface MutationContext {
  actor?: { userId: string } | null;
}
