import { ActionEntity, ActionDataEntity } from "shiplight-types";

export class ActionData {
  constructor(
    public actionName: string,
    public args: any[],
    public kwargs: { [key: string]: any }
  ) {}

  static fromEntity(entity: ActionDataEntity): ActionData {
    return new ActionData(entity.action_name, entity.args ?? [], entity.kwargs);
  }

  toEntity(): ActionDataEntity {
    return {
      action_name: this.actionName,
      args: this.args,
      kwargs: this.kwargs,
    };
  }

  static hydrate(plainObject: any): ActionData | null {
    if (!plainObject) return null;

    return new ActionData(
      plainObject.actionName,
      plainObject.args || [],
      plainObject.kwargs || {}
    );
  }
}

export class Action {
  constructor(
    public actionDescription: string,
    public actionData: ActionData,
    public locator?: string,
    public xpath?: string,
    public cssSelector?: string,
    public framePath?: string[],
    public artifacts?: Record<string, any>,
  ) {}

  static fromEntity(entity: ActionEntity): Action {
    return new Action(
      entity.action_description,
      // This is for backward compatibility, migrating from action to action_data
      ActionData.fromEntity(
        entity.action_data ||
          entity.action || { action_name: "", args: [], kwargs: {} }
      ),
      entity.locator,
      entity.xpath,
      entity.css_selector,
      entity.frame_path,
      entity.artifacts,
    );
  }

  toEntity(): ActionEntity {
    return {
      url: "",
      action_description: this.actionDescription,
      feedback: "",
      action_data: this.actionData.toEntity(),
      locator: this.locator,
      xpath: this.xpath,
      css_selector: this.cssSelector,
      frame_path: this.framePath,
      artifacts: this.artifacts,
    };
  }

  static hydrate(plainObject: any): Action | null {
    if (!plainObject) return null;

    const actionData = plainObject.actionData
      ? ActionData.hydrate(plainObject.actionData)
      : new ActionData("", [], {});

    if (!actionData) return null;

    return new Action(
      plainObject.actionDescription,
      actionData,
      plainObject.locator,
      plainObject.xpath,
      plainObject.cssSelector,
      plainObject.framePath,
      plainObject.artifacts,
    );
  }
}
