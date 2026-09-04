// common/entities/issueEntity.ts
export type IssueStatus = 'Open' | 'In Progress' | 'Ready for Verification' | 'Closed';

export interface IssueEntity {
  id?: number;
  organization_id: string;

  // Core fields
  title?: string;
  description?: string;
  status?: string;
  tags?: string[];
  external_ticket_url?: string;

  // Test relationships
  test_case_id?: number;
  test_case_result_ids?: number[];
  test_runs_ids?: number[];

  // User tracking
  created_by?: string;
  updated_by?: string;

  // Timestamps
  created_at?: string;
  updated_at?: string;
  deleted_at?: string;

  // Metadata
  metadata?: Record<string, any>;
}