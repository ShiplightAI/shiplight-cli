// common/entities/organizationEntity.ts

import type { OrganizationSettings } from 'shiplight-types';

export interface KnowledgeBaseConfig {
  bedrock_knowledge_base_id: string;
  inline_data_source_id?: string;
  inline_knowledge_weight: number;
  web_doc_data_source_id?: string;
  web_doc_knowledge_weight: number;
}

export interface OrganizationEntity {
  organization_id: string;
  created_at?: string;
  name?: string;
  updated_at?: string;
  icon?: string;
  settings?: OrganizationSettings;
  knowledge_base_config?: KnowledgeBaseConfig;
  cluster_id?: string;
  domain_auto_join_enabled?: boolean;
  deleted?: boolean;
}
