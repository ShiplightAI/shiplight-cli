import { IssueEntity, IssueStatus } from "../entities/issueEntity";

// Re-export IssueStatus for use in frontend
export type { IssueStatus };

export class Issue {
  constructor(
    public organizationId: string,
    public id?: number,
    public title?: string,
    public description?: string,
    public status?: IssueStatus,
    public tags?: string[],
    public externalTicketUrl?: string,
    public testCaseId?: number,
    public testCaseResultIds?: number[],
    public testRunsIds?: number[],
    public createdBy?: string,
    public updatedBy?: string,
    public createdAt?: Date,
    public updatedAt?: Date,
    public deletedAt?: Date,
    public metadata?: Record<string, any>
  ) {}

  // Convert from entity to model
  static fromEntity(entity: IssueEntity): Issue {
    return new Issue(
      entity.organization_id,
      entity.id,
      entity.title,
      entity.description,
      entity.status as IssueStatus,
      entity.tags,
      entity.external_ticket_url,
      entity.test_case_id,
      entity.test_case_result_ids,
      entity.test_runs_ids,
      entity.created_by,
      entity.updated_by,
      entity.created_at ? new Date(entity.created_at) : undefined,
      entity.updated_at ? new Date(entity.updated_at) : undefined,
      entity.deleted_at ? new Date(entity.deleted_at) : undefined,
      entity.metadata
    );
  }

  // Convert from model to entity
  toEntity(): IssueEntity {
    return {
      organization_id: this.organizationId,
      id: this.id,
      title: this.title,
      description: this.description,
      status: this.status,
      tags: this.tags,
      external_ticket_url: this.externalTicketUrl,
      test_case_id: this.testCaseId,
      test_case_result_ids: this.testCaseResultIds,
      test_runs_ids: this.testRunsIds,
      created_by: this.createdBy,
      updated_by: this.updatedBy,
      created_at: this.createdAt?.toISOString(),
      updated_at: this.updatedAt?.toISOString(),
      deleted_at: this.deletedAt?.toISOString(),
      metadata: this.metadata
    };
  }

  // Helper methods
  isOpen(): boolean {
    return this.status === 'Open';
  }

  isClosed(): boolean {
    return this.status === 'Closed';
  }

  addTag(tag: string): void {
    if (!this.tags) {
      this.tags = [];
    }
    if (!this.tags.includes(tag)) {
      this.tags.push(tag);
    }
  }

  removeTag(tag: string): void {
    if (this.tags) {
      this.tags = this.tags.filter(t => t !== tag);
    }
  }

  linkTestRun(testRunId: number): void {
    if (!this.testRunsIds) {
      this.testRunsIds = [];
    }
    if (!this.testRunsIds.includes(testRunId)) {
      this.testRunsIds.push(testRunId);
    }
  }

  linkTestCaseResult(testCaseResultId: number): void {
    if (!this.testCaseResultIds) {
      this.testCaseResultIds = [];
    }
    if (!this.testCaseResultIds.includes(testCaseResultId)) {
      this.testCaseResultIds.push(testCaseResultId);
    }
  }

  // Get shareable content for external systems
  getShareableContent(format: 'url' | 'title-url' | 'full', baseUrl: string): string {
    const url = `${baseUrl}/issues/${this.id}`;

    switch (format) {
      case 'url':
        return url;

      case 'title-url':
        return `${this.title}\n${url}`;

      case 'full':
        const lines = [
          `Title: ${this.title}`,
          `Status: ${this.status}`,
          `URL: ${url}`,
          ''
        ];

        if (this.description) {
          lines.push('Description:', this.description, '');
        }

        if (this.tags && this.tags.length > 0) {
          lines.push(`Tags: ${this.tags.join(', ')}`, '');
        }

        if (this.externalTicketUrl) {
          lines.push(`External Ticket: ${this.externalTicketUrl}`, '');
        }

        return lines.join('\n');

      default:
        return url;
    }
  }
}