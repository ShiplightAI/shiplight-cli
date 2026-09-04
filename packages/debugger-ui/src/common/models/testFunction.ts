import { TestFunctionEntity } from "../entities/testFunctionEntity";
import { TestFunctionStatus } from "../constants";
import type { TestAccountGroupConfig } from "../entities/testEnvironmentConfigEntity";

export class TestFunction {
    constructor(
        public organizationId: string,
        public id: number,
        public name: string,
        public createdAt?: string,
        public updatedAt?: string,
        public description?: string,
        public code?: string,
        public testCode?: string,
        public status?: TestFunctionStatus,
        public disableAutoLogin?: boolean,
        public environmentId?: number,
        public startingUrlPath?: string,
        public testAccountGroup?: TestAccountGroupConfig,
        public usedBy?: number,
        public createdBy?: string,
        public updatedBy?: string,
    ) { }

    static fromEntity(entity: TestFunctionEntity): TestFunction {
        return new TestFunction(
            entity.organization_id,
            entity.id,
            entity.name,
            entity.created_at,
            entity.updated_at,
            entity.description,
            entity.code,
            entity.test_code,
            entity.status,
            entity.disable_auto_login,
            entity.environment_id,
            entity.starting_path,
            entity.test_account_group,
            entity.used_by,
            entity.created_by,
            entity.updated_by,
        );
    }

    toEntity(): TestFunctionEntity {
        return {
            organization_id: this.organizationId,
            id: this.id,
            name: this.name,
            description: this.description,
            code: this.code,
            test_code: this.testCode,
            status: this.status,
            disable_auto_login: this.disableAutoLogin,
            environment_id: this.environmentId,
            starting_path: this.startingUrlPath,
            test_account_group: this.testAccountGroup,
            used_by: this.usedBy,
            created_by: this.createdBy,
            updated_by: this.updatedBy,
        };
    }
}