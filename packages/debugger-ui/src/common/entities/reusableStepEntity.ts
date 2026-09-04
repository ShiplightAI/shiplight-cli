import { Statement } from "shiplight-types";

export interface ReusableStepEntity {
    organization_id: string;
    id: number;
    name: string;
    description?: string;
    statements: Statement[];
    created_at?: string;
    updated_at?: string;
    created_by?: string;
    updated_by?: number;
    usage_count?: number; // Number of test cases using this reusable step
}
