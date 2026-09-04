// common/models/environment.ts

import { EnvironmentEntity } from "../entities/environmentEntity";

export class Environment {
  constructor(
    public organizationId: string,
    public id?: number,
    public name?: string,
    public description?: string,
    public url?: string,
    public loginTestId?: number,
    public storageStateSaveTestId?: number,
    public storageStateLoginTestId?: number,
    public enableStorageStateLogin?: boolean,
    public loginCookies?: Record<string, any>[],
  ) {}

  // Static factory method to create an Environment from an entity
  static fromEntity(entity: EnvironmentEntity): Environment {
    return new Environment(
      entity.organization_id,
      entity.id ?? undefined,
      entity.name,
      entity.description ?? undefined,
      entity.url,
      entity.login_test_id ?? undefined,
      entity.storage_state_save_test_id ?? undefined,
      entity.storage_state_login_test_id ?? undefined,
      entity.enable_storage_state_login ?? undefined,
      entity.login_cookies ?? undefined,
    );
  }

  // Method to convert this Environment object back to an EnvironmentEntity
  toEntity(): EnvironmentEntity {
    return {
      organization_id: this.organizationId,
      id: this.id ?? undefined,
      name: this.name ?? "",
      description: this.description ?? undefined,
      url: this.url ?? "",
      login_test_id: this.loginTestId ?? undefined,
      storage_state_save_test_id: this.storageStateSaveTestId ?? undefined,
      storage_state_login_test_id: this.storageStateLoginTestId ?? undefined,
      enable_storage_state_login: this.enableStorageStateLogin ?? false,
      login_cookies: this.loginCookies ?? undefined,
    };
  }
}

// EnvironmentBuilder class
export class EnvironmentBuilder {
  private id?: number;
  private name?: string;
  private description?: string;
  private url?: string;
  private loginTestId?: number;
  private storageStateSaveTestId?: number;
  private storageStateLoginTestId?: number;
  private enableStorageStateLogin?: boolean;
  private loginCookies?: Record<string, any>[];
  constructor(private organizationId: string) {}  // Required field

  withId(id: number) {
    this.id = id;
    return this;
  }

  withName(name: string) {
    this.name = name;
    return this;
  }

  withDescription(description: string) {
    this.description = description;
    return this;
  }

  withUrl(url: string) {
    this.url = url;
    return this;
  }

  withLoginTestId(loginTestId: number) {
    this.loginTestId = loginTestId;
    return this;
  }

  withStorageStateSaveTestId(storageStateSaveTestId: number) {
    this.storageStateSaveTestId = storageStateSaveTestId;
    return this;
  }

  withStorageStateLoginTestId(storageStateLoginTestId: number) {
    this.storageStateLoginTestId = storageStateLoginTestId;
    return this;
  }

  withEnableStorageStateLogin(enableStorageStateLogin: boolean) {
    this.enableStorageStateLogin = enableStorageStateLogin;
    return this;
  }

  withLoginCookies(loginCookies: Record<string, any>[]) {
    this.loginCookies = loginCookies;
    return this;
  }

  build(): Environment {
    return new Environment(
      this.organizationId,
      this.id,
      this.name,
      this.description,
      this.url,
      this.loginTestId,
      this.storageStateSaveTestId,
      this.storageStateLoginTestId,
      this.enableStorageStateLogin,
      this.loginCookies,
    );
  }
}