import { UserProfileEntity } from "../entities/userProfileEntity";
import { OrganizationMemberRole } from "../constants";

export class UserProfile {
  constructor(
    public id: string,
    public fullName: string,
    public email: string,
    public avatarUrl?: string,
    public signedUrl?: string,
    public firstName?: string,
    public lastName?: string,
    public organizationId?: string,
    public role?: OrganizationMemberRole,
  ) {}

  static fromEntity(entity: UserProfileEntity, role?: OrganizationMemberRole): UserProfile {
    return new UserProfile(
      entity.id,
      entity.full_name || '',
      entity.email || '',
      entity.avatar_url,
      undefined, // signedUrl will be set separately if needed
      entity.first_name,
      entity.last_name,
      entity.organization_id,
      role,
    );
  }

  /**
   * Create a UserProfile instance from a plain JavaScript object
   * This is useful when the data comes directly from an API response
   */
  static hydrate(plainObject: any): UserProfile | null {
    if (!plainObject) return null;
    
    return new UserProfile(
      plainObject.id,
      plainObject.fullName || '',
      plainObject.email || '',
      plainObject.avatarUrl,
      plainObject.signedUrl,
      plainObject.firstName,
      plainObject.lastName,
      plainObject.organizationId,
      plainObject.role
    );
  }

  toEntity(): UserProfileEntity {
    return {
      id: this.id,
      full_name: this.fullName,
      email: this.email,
      avatar_url: this.avatarUrl,
      first_name: this.firstName,
      last_name: this.lastName,
      organization_id: this.organizationId,
    };
  }
}

export class UserProfileBuilder {
  private fullName: string = "";
  private email: string = "";
  private avatarUrl?: string;
  private signedUrl?: string;
  private firstName?: string;
  private lastName?: string;
  private organizationId?: string;
  private role?: OrganizationMemberRole;

  constructor(private id: string) {} // Required field

  withFullName(fullName: string) {
    this.fullName = fullName;
    return this;
  }

  withEmail(email: string) {
    this.email = email;
    return this;
  }

  withAvatarUrl(avatarUrl: string) {
    this.avatarUrl = avatarUrl;
    return this;
  }

  withSignedUrl(signedUrl: string) {
    this.signedUrl = signedUrl;
    return this;
  }

  withFirstName(firstName: string) {
    this.firstName = firstName;
    return this;
  }

  withLastName(lastName: string) {
    this.lastName = lastName;
    return this;
  }

  withOrganizationId(organizationId: string) {
    this.organizationId = organizationId;
    return this;
  }

  withRole(role: OrganizationMemberRole) {
    this.role = role;
    return this;
  }

  build(): UserProfile {
    return new UserProfile(
      this.id,
      this.fullName,
      this.email,
      this.avatarUrl,
      this.signedUrl,
      this.firstName,
      this.lastName,
      this.organizationId,
      this.role,
    );
  }
}
