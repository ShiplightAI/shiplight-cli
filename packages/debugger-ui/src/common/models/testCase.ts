import { TestCaseEntity, TestCaseSettings } from "../entities/testCaseEntity";
import { TestFlow, ActionEntityStore } from "shiplight-types";
import { ActionEntity } from "shiplight-types";
import { TestEnvironmentConfig } from "./testEnvironmentConfig";
import { Action } from "./testStep";

export class TestCase {
  constructor(
    public organizationId: string,
    public id?: number,
    public title?: string,
    public description?: string,
    public status?: string,
    public codeS3Path?: string,
    public createdAt?: Date,
    public updatedAt?: Date,
    public stepsS3Path?: string,
    public agentTaskId?: number,
    public actionSteps?: Action[],
    public labelIds: number[] = [],
    public testDataIds?: number[],
    public environmentConfigs?: TestEnvironmentConfig[],
    public testFlow?: TestFlow,
    /** Cached action entities keyed by statement UID - separate from testFlow */
    public actionEntities?: ActionEntityStore,
    public testAccountIds?: number[],
    public timeoutMinutes?: number,
    public createdBy?: string,
    public updatedBy?: string,
    public disableAutoLogin?: boolean,
    public deviceName?: string,
    public folderId?: number,
    public settings?: TestCaseSettings,
    public metadata?: Record<string, unknown>,
  ) {}

  // Static factory method to create a TestCase from an entity
  static fromEntity(entity: TestCaseEntity): TestCase {
    return new TestCase(
      entity.organization_id,
      entity.id,
      entity.title,
      entity.description,
      entity.status,
      entity.code_s3_path,
      entity.created_at ? new Date(entity.created_at) : undefined,
      entity.updated_at ? new Date(entity.updated_at) : undefined,
      entity.steps_s3_path,
      entity.agent_task_id,
      entity.action_steps?.map((action: ActionEntity) => Action.fromEntity(action)),
      [], // labelIds will be populated later
      entity.test_data_ids,
      entity.environment_configs?.map((config) => TestEnvironmentConfig.fromEntity(config)),
      entity.test_flow,
      entity.action_entities,
      entity.test_account_ids,
      entity.timeout_minutes,
      entity.created_by,
      entity.updated_by,
      entity.disable_auto_login,
      entity.device_name,
      entity.folder_id,
      entity.settings,
      entity.metadata,
    );
  }

  // Method to convert this TestCase object back to a TestCaseEntity
  toEntity(): TestCaseEntity {
    // labelIds is not part of the entity - it's a derived property
    return {
      organization_id: this.organizationId,
      id: this.id ?? undefined,
      title: this.title ?? undefined,
      description: this.description ?? undefined,
      status: this.status ?? undefined,
      code_s3_path: this.codeS3Path ?? undefined,
      created_at: this.createdAt?.toISOString() ?? undefined,
      updated_at: this.updatedAt?.toISOString() ?? undefined,
      steps_s3_path: this.stepsS3Path ?? undefined,
      agent_task_id: this.agentTaskId ?? undefined,
      action_steps: this.actionSteps?.map((action: Action) => action.toEntity()),
      test_data_ids: this.testDataIds ?? undefined,
      environment_configs: this.environmentConfigs?.map((config) => config.toEntity()) ?? undefined,
      test_flow: this.testFlow ?? undefined,
      action_entities: this.actionEntities ?? undefined,
      test_account_ids: this.testAccountIds ?? undefined,
      timeout_minutes: this.timeoutMinutes ?? undefined,
      created_by: this.createdBy,
      updated_by: this.updatedBy,
      disable_auto_login: this.disableAutoLogin ?? undefined,
      device_name: this.deviceName ?? undefined,
      folder_id: this.folderId ?? undefined,
      settings: this.settings ?? undefined,
      metadata: this.metadata ?? undefined,
    };
  }


  clone(): TestCase {
    return new TestCase(
      this.organizationId,
      this.id,
      this.title,
      this.description,
      this.status,
      this.codeS3Path,
      this.createdAt ? new Date(this.createdAt) : undefined,
      this.updatedAt ? new Date(this.updatedAt) : undefined,
      this.stepsS3Path,
      this.agentTaskId,
      this.actionSteps ? [...this.actionSteps] : undefined,
      [...this.labelIds],
      this.testDataIds ? [...this.testDataIds] : undefined,
      this.environmentConfigs ? [...this.environmentConfigs] : undefined,
      this.testFlow,
      this.actionEntities,
      this.testAccountIds,
      this.timeoutMinutes,
      this.createdBy,
      this.updatedBy,
      this.disableAutoLogin,
      this.deviceName,
      this.folderId,
      this.settings ? { ...this.settings } : undefined,
      this.metadata ? { ...this.metadata } : undefined,
    );
  }

  static hydrate(plainObject: any): TestCase | null {
    if (!plainObject) return null;

    // Convert action steps if they exist
    const actionSteps = plainObject.actionSteps
      ? plainObject.actionSteps.map(Action.hydrate)
      : undefined;

    // Convert environment configs if they exist
    const environmentConfigs = plainObject.environmentConfigs
      ? plainObject.environmentConfigs.map(TestEnvironmentConfig.hydrate)
      : undefined;

    // Convert dates from strings to Date objects
    const createdAt = plainObject.createdAt ? new Date(plainObject.createdAt) : undefined;
    const updatedAt = plainObject.updatedAt ? new Date(plainObject.updatedAt) : undefined;

    return new TestCase(
      plainObject.organizationId,
      plainObject.id,
      plainObject.title,
      plainObject.description,
      plainObject.status,
      plainObject.codeS3Path,
      createdAt,
      updatedAt,
      plainObject.stepsS3Path,
      plainObject.agentTaskId,
      actionSteps,
      plainObject.labelIds ?? [],
      plainObject.testDataIds,
      environmentConfigs,
      plainObject.testFlow,
      plainObject.actionEntities,
      plainObject.testAccountIds,
      plainObject.timeoutMinutes,
      plainObject.createdBy,
      plainObject.updatedBy,
      plainObject.disableAutoLogin,
      plainObject.deviceName,
      plainObject.folderId,
      plainObject.settings
    );
  }
}

export class TestCaseBuilder {
  private id?: number;
  private title?: string;
  private description?: string;
  private status?: string;
  private codeS3Path?: string;
  private createdAt?: Date;
  private updatedAt?: Date;
  private stepsS3Path?: string;
  private agentTaskId?: number;
  private actionSteps?: Action[];
  private labelIds: number[] = [];
  private testDataIds?: number[] = [];
  private environmentConfigs?: TestEnvironmentConfig[];
  private testFlow?: TestFlow;
  private actionEntities?: ActionEntityStore;
  private testAccountIds?: number[];
  private timeoutMinutes?: number;
  private createdBy?: string;
  private updatedBy?: string;
  private disableAutoLogin?: boolean;
  private deviceName?: string;
  private folderId?: number;
  private settings?: TestCaseSettings;
  constructor(private organizationId: string) { } // Required field

  withId(id: number) {
    this.id = id;
    return this;
  }

  withTitle(title: string) {
    this.title = title;
    return this;
  }

  withDescription(description: string) {
    this.description = description;
    return this;
  }

  withStatus(status: string) {
    this.status = status;
    return this;
  }

  withCodeS3Path(codeS3Path: string) {
    this.codeS3Path = codeS3Path;
    return this;
  }

  withCreatedAt(createdAt: Date) {
    this.createdAt = createdAt;
    return this;
  }

  withUpdatedAt(updatedAt: Date) {
    this.updatedAt = updatedAt;
    return this;
  }

  withStepsS3Path(stepsS3Path: string) {
    this.stepsS3Path = stepsS3Path;
    return this;
  }

  withAgentTaskId(agentTaskId: number) {
    this.agentTaskId = agentTaskId;
    return this;
  }

  withActionSteps(actionSteps: Action[]) {
    this.actionSteps = actionSteps;
    return this;
  }

  withLabelIds(labelIds: number[]) {
    this.labelIds = labelIds;
    return this;
  }

  withTestDataIds(testDataIds: number[]) {
    this.testDataIds = testDataIds;
    return this;
  }

  withEnvironmentConfigs(environmentConfigs: TestEnvironmentConfig[]) {
    this.environmentConfigs = environmentConfigs;
    return this;
  }

  withTestFlow(testFlow: TestFlow) {
    this.testFlow = testFlow;
    return this;
  }

  withActionEntities(actionEntities: ActionEntityStore | undefined) {
    this.actionEntities = actionEntities;
    return this;
  }

  withTestAccountIds(testAccountIds: number[]) {
    this.testAccountIds = testAccountIds;
    return this;
  }

  withTimeoutMinutes(timeoutMinutes: number) {
    this.timeoutMinutes = timeoutMinutes;
    return this;
  }

  withCreatedBy(createdBy: string) {
    this.createdBy = createdBy;
    return this;
  }

  withUpdatedBy(updatedBy: string) {
    this.updatedBy = updatedBy;
    return this;
  }

  withDisableAutoLogin(disableAutoLogin: boolean) {
    this.disableAutoLogin = disableAutoLogin;
    return this;
  }

  withDeviceName(deviceName: string) {
    this.deviceName = deviceName;
    return this;
  }

  withFolderId(folderId: number | undefined) {
    this.folderId = folderId;
    return this;
  }

  withSettings(settings: TestCaseSettings | undefined) {
    this.settings = settings;
    return this;
  }

  build(): TestCase {
    return new TestCase(
      this.organizationId,
      this.id,
      this.title,
      this.description,
      this.status,
      this.codeS3Path,
      this.createdAt,
      this.updatedAt,
      this.stepsS3Path,
      this.agentTaskId,
      this.actionSteps,
      this.labelIds,
      this.testDataIds,
      this.environmentConfigs,
      this.testFlow,
      this.actionEntities,
      this.testAccountIds,
      this.timeoutMinutes,
      this.createdBy,
      this.updatedBy,
      this.disableAutoLogin,
      this.deviceName,
      this.folderId,
      this.settings
    );
  }
}
