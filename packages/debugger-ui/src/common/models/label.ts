import { LabelEntity } from "../entities/labelEntity";

export class Label {
  constructor(
    public organizationId: string,
    public name: string,
    public color: string,
    public id?: number,
    public createdAt?: Date,
    public updatedAt?: Date
  ) {}

  static fromEntity(entity: LabelEntity): Label {
    return new Label(
      entity.organization_id,
      entity.name,
      entity.color,
      entity.id,
      entity.created_at ? new Date(entity.created_at) : undefined,
      entity.updated_at ? new Date(entity.updated_at) : undefined
    );
  }

  toEntity(): LabelEntity {
    return {
      organization_id: this.organizationId,
      name: this.name,
      color: this.color,
      id: this.id ?? undefined,
      created_at: this.createdAt?.toISOString() ?? undefined,
      updated_at: this.updatedAt?.toISOString() ?? undefined,
    };
  }
}

export class LabelBuilder {
  private id?: number;
  private name: string = "";
  private color: string = "";
  private createdAt?: Date;
  private updatedAt?: Date;

  constructor(private organizationId: string) {} // Required field

  withId(id: number) {
    this.id = id;
    return this;
  }

  withName(name: string) {
    this.name = name;
    return this;
  }

  withColor(color: string) {
    this.color = color;
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

  build(): Label {
    return new Label(
      this.organizationId,
      this.name,
      this.color,
      this.id,
      this.createdAt,
      this.updatedAt
    );
  }
}
