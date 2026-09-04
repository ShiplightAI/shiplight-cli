import { KnowledgeBaseConfig, OrganizationEntity } from "../entities/organizationEntity";


export class Organization {
  constructor(
    public organizationId: string,
    public createdAt?: Date,
    public name?: string,
    public updatedAt?: Date,
    public icon?: string,
    public settings?: Record<string, any>,
    public knowledgeBaseConfig?: KnowledgeBaseConfig,
    public clusterId?: string,
    public deleted?: boolean
  ) {}

  // Static factory method to create an Organization from an entity
  static fromEntity(entity: OrganizationEntity): Organization {
    return new Organization(
      entity.organization_id,
      entity.created_at ? new Date(entity.created_at) : undefined,
      entity.name,
      entity.updated_at ? new Date(entity.updated_at) : undefined,
      entity.icon,
      entity.settings,
      entity.knowledge_base_config,
      entity.cluster_id,
      entity.deleted
    );
  }

  // Method to convert this Organization object back to an OrganizationEntity
  toEntity(): OrganizationEntity {
    return {
      organization_id: this.organizationId,
      created_at: this.createdAt?.toISOString() ?? undefined,
      name: this.name ?? undefined,
      updated_at: this.updatedAt?.toISOString() ?? undefined,
      icon: this.icon ?? undefined,
      settings: this.settings ?? undefined,
      knowledge_base_config: this.knowledgeBaseConfig ?? undefined,
      cluster_id: this.clusterId ?? undefined,
      deleted: this.deleted ?? undefined,
    };
  }
}

export class OrganizationBuilder {
  private createdAt?: Date;
  private name?: string;
  private updatedAt?: Date;
  private icon?: string;
  private settings?: Record<string, any>;
  private knowledgeBaseConfig?: KnowledgeBaseConfig;
  private clusterId?: string;
  private deleted?: boolean;
  constructor(private organizationId: string) {} // Required field

  withCreatedAt(createdAt: Date) {
    this.createdAt = createdAt;
    return this;
  }

  withName(name: string) {
    this.name = name;
    return this;
  }

  withUpdatedAt(updatedAt: Date) {
    this.updatedAt = updatedAt;
    return this;
  }

  withIcon(icon: string) {
    this.icon = icon;
    return this;
  }

  withSettings(settings: Record<string, any>) {
    this.settings = settings;
    return this;
  }

  withKnowledgeBaseConfig(knowledgeBaseConfig: KnowledgeBaseConfig) {
    this.knowledgeBaseConfig = knowledgeBaseConfig;
    return this;
  }

  withClusterId(clusterId: string) {
    this.clusterId = clusterId;
    return this;
  }

  withDeleted(deleted: boolean) {
    this.deleted = deleted;
    return this;
  }

  build(): Organization {
    return new Organization(
      this.organizationId,
      this.createdAt,
      this.name,
      this.updatedAt,
      this.icon,
      this.settings,
      this.knowledgeBaseConfig,
      this.clusterId,
      this.deleted
    );
  }
}
