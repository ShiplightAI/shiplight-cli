import { EnvironmentHooksConfig, TestEnvironmentConfigEntity, TestAccountGroupConfig } from "../entities/testEnvironmentConfigEntity";

export class TestEnvironmentConfig {
  constructor(
    public environmentId: number,
    public testAccountGroup: TestAccountGroupConfig,
    public path?: string,
    public isDefaultDebug?: boolean,
    public hooks?: EnvironmentHooksConfig,
  ) {}

  static fromEntity(entity: TestEnvironmentConfigEntity): TestEnvironmentConfig {
    return new TestEnvironmentConfig(
      entity.environment_id,
      entity.test_account_group,
      entity.path,
      entity.is_default_debug,
      entity.hooks,
    );
  }

  toEntity(): TestEnvironmentConfigEntity {
    return {
      environment_id: this.environmentId,
      test_account_group: this.testAccountGroup,
      path: this.path || "",
      is_default_debug: this.isDefaultDebug || false,
      hooks: this.hooks,
    };
  }

  static hydrate(plainObject: any): TestEnvironmentConfig | null {
    if (!plainObject) return null;

    const testAccountGroup = plainObject.testAccountGroup || {
      type: 'None',
      account_ids: [],
    };

    return new TestEnvironmentConfig(
      plainObject.environmentId,
      testAccountGroup,
      plainObject.path,
      plainObject.isDefaultDebug,
      plainObject.hooks,
    );
  }
}

export class TestEnvironmentConfigBuilder {
  private environmentId?: number;
  private testAccountGroup?: TestAccountGroupConfig;
  private path?: string;
  private isDefaultDebug?: boolean;
  private hooks?: EnvironmentHooksConfig;

  withEnvironmentId(environmentId: number) {
    this.environmentId = environmentId;
    return this;
  }

  withTestAccountGroup(testAccountGroup: TestAccountGroupConfig) {
    this.testAccountGroup = testAccountGroup;
    return this;
  }

  withPath(path?: string) {
    this.path = path;
    return this;
  }

  withIsDefaultDebug(isDefaultDebug?: boolean) {
    this.isDefaultDebug = isDefaultDebug;
    return this;
  }

  withHooks(hooks?: EnvironmentHooksConfig) {
    this.hooks = hooks;
    return this;
  }

  build(): TestEnvironmentConfig {
    if (!this.environmentId || !this.testAccountGroup) {
      throw new Error("environmentId and testAccountGroup are required to build a TestEnvironmentConfig.");
    }

    return new TestEnvironmentConfig(
      this.environmentId,
      this.testAccountGroup,
      this.path,
      this.isDefaultDebug,
      this.hooks,
    );
  }
}
