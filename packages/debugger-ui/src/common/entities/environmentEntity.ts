// common/entities/environmentEntity.ts
export interface EnvironmentEntity {
    organization_id: string;
    id?: number;
    name: string;
    description?: string;
    url: string;
    created_at?: string;
    updated_at?: string;
    login_test_id?: number;
    storage_state_save_test_id?: number;
    storage_state_login_test_id?: number;
    enable_storage_state_login?: boolean;
    login_cookies?: Record<string, any>[];
  }
