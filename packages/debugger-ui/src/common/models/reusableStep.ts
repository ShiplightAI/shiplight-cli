import { ReusableStepEntity } from "../entities/reusableStepEntity";
import { Statement } from "shiplight-types";

export class ReusableStep {
    constructor(
        public organizationId: string,
        public id: number,
        public name: string,
        public statements: Statement[],
        public description?: string,
        public createdAt?: string,
        public updatedAt?: string,
        public createdBy?: string,
        public updatedBy?: number,
        public usageCount?: number,
    ) { }

    static fromEntity(entity: ReusableStepEntity): ReusableStep {
        return new ReusableStep(
            entity.organization_id,
            entity.id,
            entity.name,
            entity.statements,
            entity.description,
            entity.created_at,
            entity.updated_at,
            entity.created_by,
            entity.updated_by,
            entity.usage_count,
        );
    }

    toEntity(): ReusableStepEntity {
        return {
            organization_id: this.organizationId,
            id: this.id,
            name: this.name,
            description: this.description,
            statements: this.statements,
            created_at: this.createdAt,
            updated_at: this.updatedAt,
            created_by: this.createdBy,
            updated_by: this.updatedBy,
            usage_count: this.usageCount,
        };
    }
}
