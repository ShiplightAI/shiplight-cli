import { TestFunctionStatus } from "../constants";
import type { TestAccountGroupConfig } from "./testEnvironmentConfigEntity";

/**
 * Public TestFunctionEntity - use this for all application code.
 * Only includes the new inline test_account_group field.
 */
export interface TestFunctionEntity {
    organization_id: string;
    id: number;
    name: string;
    description?: string;
    code?: string;
    test_code?: string;
    created_at?: string;
    updated_at?: string;
    status?: TestFunctionStatus;
    disable_auto_login?: boolean;
    environment_id?: number;
    starting_path?: string;
    /** Inline test account group configuration */
    test_account_group?: TestAccountGroupConfig;
    used_by?: number;
    created_by?: string;
    updated_by?: string;
}

/**
 * Raw DB entity - includes legacy test_account_group_id for reading from database.
 * Only used internally by DB service for normalization.
 * @internal
 */
export interface LegacyTestFunctionEntity extends TestFunctionEntity {
    /** Legacy field - read-only for backwards compatibility */
    test_account_group_id?: number;
}
