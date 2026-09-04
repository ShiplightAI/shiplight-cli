import { Issue as IssueModel, IssueStatus } from '@/common/models/issue';

// Frontend-specific Issue type with string dates (for API responses)
export interface Issue {
  id: number;
  organizationId: string;
  title: string;
  description?: string;
  status: IssueStatus;
  tags?: string[];
  externalTicketUrl?: string;
  testCaseId?: number;
  testCaseResultIds?: number[];
  testRunsIds?: number[];
  createdBy?: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  metadata?: Record<string, any>;
}

// Re-export IssueStatus
export type { IssueStatus };

// Frontend-specific request/response types
export interface CreateIssueRequest {
  title: string;
  description?: string;
  status?: IssueStatus;
  tags?: string[];
  externalTicketUrl?: string;
  testCaseId?: number;
  testRunId?: number;
  testCaseResultId?: number;
}

export interface UpdateIssueRequest {
  title?: string;
  description?: string;
  status?: IssueStatus;
  tags?: string[];
  externalTicketUrl?: string;
}

export interface IssueSearchParams {
  search?: string;
  status?: IssueStatus | null;
  tags?: string[];
  sortBy?: 'created_at' | 'updated_at' | 'title' | 'status';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface IssueSearchResult {
  issues: Issue[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface LinkTestRunRequest {
  testRunId: number;
  testCaseResultId?: number;
  linkReason?: string;
}

export interface ShareableContentRequest {
  format: 'url' | 'title-url' | 'full';
}

export interface ShareableContentResponse {
  content: string;
}

// UI helper constants
export const ISSUE_STATUS_OPTIONS = [
  { value: 'Open', label: 'Open', color: 'red' },
  { value: 'In Progress', label: 'In Progress', color: 'blue' },
  { value: 'Ready for Verification', label: 'Ready for Verification', color: 'yellow' },
  { value: 'Closed', label: 'Closed', color: 'green' },
] as const;

export const ISSUE_SORT_OPTIONS = [
  { value: 'created_at', label: 'Created Date' },
  { value: 'updated_at', label: 'Updated Date' },
  { value: 'title', label: 'Title' },
  { value: 'status', label: 'Status' },
] as const;