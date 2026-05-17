import type { ZodIssue } from 'zod';

export class ValidationError extends Error {
  readonly issues: ZodIssue[];
  constructor(issues: ZodIssue[]) {
    super('validation failed');
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}
