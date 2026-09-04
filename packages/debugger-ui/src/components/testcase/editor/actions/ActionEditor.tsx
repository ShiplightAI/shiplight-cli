import React from 'react';
import { useTranslations } from 'next-intl';
import { BasicActionEditor } from './BasicActionEditor';
import { AssertionEditor } from './AssertionEditor';
import { CodeEditor } from './CodeEditor';
import { FunctionEditor } from './FunctionEditor';
import { FileUploadEditor } from './FileUploadEditor';
import { ExtractContentEditor } from './ExtractContentEditor';
import { getActionTypeFromActionName } from '../../utils/actionIconUtils';
import { TestStepActionType } from '@/common/constants';
import { TestFunction } from '@/common/models/testFunction';
import { useEditor } from '../contexts/EditorContext';
import { LoginEditor } from './LoginEditor';
import { ExtractEmailContentWithActionEditor } from './ExtractEmailContentEditor';
import { ExtractEmailContentConfig } from './ExtractEmailContentModal';
import { WaitUntilEditor } from './WaitUntilEditor';

interface ActionEditorProps {
  actionName: string;
  description: string;
  selectedActionType?: string | null;
  hasActionEntity: boolean;
  actionEntity?: any; // The full action_entity object to extract code from
  onDescriptionChange: (newDescription: string) => void;
  onFindElement?: () => void;
  onCodeConfirm?: (code: string) => void;
  onCodeCancel?: () => void;
  onFunctionSelect?: (func: TestFunction, paramValues?: Record<string, string>) => void;
  onFunctionCancel?: () => void;
  onFileUploadSelect?: (files: Array<{ fileName: string; testDataId: number }>, targetDescription?: string) => void;
  onFileUploadCancel?: () => void;
  onExtractContentConfirm?: (elementDescription: string, variableName: string) => void;
  onExtractContentCancel?: () => void;
  onLoginConfirm?: (testAccountId: number, environmentId?: number) => void;
  onLoginCancel?: () => void;
  onExtractEmailContentConfirm?: (config: ExtractEmailContentConfig) => void;
  onExtractEmailContentCancel?: () => void;
  onWaitUntilConfirm?: (condition: string, timeoutSeconds: number) => void;
  enabled?: boolean; // Controls whether editing is allowed
  isNewlyCreated?: boolean; // Indicates if this action was just created from menu
}

export const ActionEditor: React.FC<ActionEditorProps> = ({
  actionName,
  description,
  selectedActionType,
  hasActionEntity,
  actionEntity,
  onDescriptionChange,
  onFindElement,
  onCodeConfirm,
  onCodeCancel,
  onFunctionSelect,
  onFunctionCancel,
  onFileUploadSelect,
  onFileUploadCancel,
  onExtractContentConfirm,
  onExtractContentCancel,
  onLoginConfirm,
  onLoginCancel,
  onExtractEmailContentConfirm,
  onExtractEmailContentCancel,
  onWaitUntilConfirm,
  enabled,
  isNewlyCreated,
}) => {
  const t = useTranslations('TestCases');
  // Get default environment from editor context
  const { defaultEnvironmentId } = useEditor();
  const currentActionType = getActionTypeFromActionName(actionName);
  const isCodeAction = selectedActionType === "js_code" || actionName === "js_code";
  const isAssertionAction = currentActionType === TestStepActionType.Assertion;
  const isFunctionAction = currentActionType === TestStepActionType.Function;
  const isUploadFileAction = currentActionType === TestStepActionType.UploadFile;
  const isExtractContentAction = currentActionType === TestStepActionType.ExtractContent;
  const isLoginAction = currentActionType === TestStepActionType.Login;
  const isExtractEmailContentAction = currentActionType === TestStepActionType.ExtractEmailContent;
  const isWaitUntilAction = currentActionType === TestStepActionType.WaitUntil;

  // Handle description change with action entity creation
  const handleDescriptionChange = (newDescription: string) => {
    onDescriptionChange(newDescription);
  };

  // Determine placeholder text
  const getPlaceholder = () => {
    if (!selectedActionType && !hasActionEntity) {
      return t('actionEditor.selectActionType');
    }
    if (isAssertionAction) {
      return t('actionEditor.enterAssertion');
    }
    if (isFunctionAction) {
      return t('actionEditor.functionModal');
    }
    if (isLoginAction) {
      return t('actionEditor.loginModal');
    }
    if (isExtractEmailContentAction) {
      return t('actionEditor.emailModal');
    }
    if (isWaitUntilAction) {
      return t('actionEditor.waitCondition');
    }
    return t('actionEditor.enterAction');
  };

  const getEmptyText = () => {
    return t('actionEditor.clickToAdd');
  };

  // Render appropriate editor based on action type
  if (isCodeAction) {
    // Extract existing code from action_entity if available
    const existingCode = actionEntity?.action_data?.kwargs?.code || "";

    return (
      <div className="flex flex-col gap-1">
        <BasicActionEditor
          description={description}
          onDescriptionChange={handleDescriptionChange}
          placeholder={getPlaceholder()}
          emptyText={getEmptyText()}
          enabled={enabled}
        />
        <CodeEditor
          initialCode={existingCode}
          onConfirm={onCodeConfirm}
          onCancel={onCodeCancel}
          readOnly={!enabled}
        />
      </div>
    );
  }

  if (isFunctionAction) {
    // Extract function details from action_entity if available
    const functionName = actionEntity?.action_data?.kwargs?.functionName;
    const functionId = actionEntity?.action_data?.kwargs?.functionId;

    const parameters: Record<string, string> = {};

    const parameterNames = actionEntity?.action_data?.kwargs?.parameterNames || [];
    const argumentValues =
      actionEntity?.action_data?.kwargs?.args
      ?? actionEntity?.action_data?.kwargs?.parameterValues
      ?? actionEntity?.action_data?.args
      ?? [];
    // Order matters here.
    parameterNames.forEach((name: string, index: number) => {
      const value = argumentValues[index];
      parameters[name] = value === null || value === undefined ? '' : String(value);
    });

    console.log("🎯 ActionEditor - Function action detected:");
    console.log("  - actionEntity:", actionEntity);
    console.log("  - functionName:", functionName);
    console.log("  - functionId:", functionId);
    console.log("  - parameters:", parameters);

    return (
      <FunctionEditor
        functionName={functionName}
        functionId={functionId}
        parameters={parameters}
        argumentValues={argumentValues}
        parameterNames={parameterNames}
        onFunctionSelect={onFunctionSelect}
        onFunctionCancel={onFunctionCancel}
        isNewlyCreated={isNewlyCreated}
        readOnly={!enabled}
      />
    );
  }

  if (isUploadFileAction) {
    // Extract file names and target description from kwargs if available
    const fileNames = actionEntity?.action_data?.kwargs?.paths || [];
    const targetDescription = actionEntity?.action_data?.kwargs?.target_description || '';

    return (
      <FileUploadEditor
        description={description}
        fileNames={fileNames}
        targetDescription={targetDescription}
        onFileSelect={onFileUploadSelect}
        onCancel={onFileUploadCancel}
        isNewlyCreated={isNewlyCreated}
        readOnly={!enabled}
      />
    );
  }

  if (isExtractContentAction) {
    // Extract save variable details from action_entity if available
    const elementDescription = actionEntity?.action_data?.kwargs?.element_description || '';
    const variableName = actionEntity?.action_data?.kwargs?.variable_name || '';

    return (
      <ExtractContentEditor
        description={description}
        elementDescription={elementDescription}
        variableName={variableName}
        onExtractContentConfirm={onExtractContentConfirm}
        onExtractContentCancel={onExtractContentCancel}
        isNewlyCreated={isNewlyCreated}
        readOnly={!enabled}
      />
    );
  }

  if (isLoginAction) {
    // Extract login details from action_entity if available
    const testAccountId = actionEntity?.action_data?.kwargs?.test_account_id;
    const environmentId = actionEntity?.action_data?.kwargs?.environment_id;

    console.log("🔍 ActionEditor - Login action detected:", {
      testAccountId,
      environmentId,
      defaultEnvironmentId,
    });

    return (
      <LoginEditor
        description={description}
        testAccountId={testAccountId}
        environmentId={environmentId}
        defaultEnvironmentId={defaultEnvironmentId}
        onLoginConfirm={onLoginConfirm}
        onLoginCancel={onLoginCancel}
        readOnly={!enabled}
      />
    );
  }

  if (isExtractEmailContentAction) {
    // Extract email extraction details from action_entity if available

    return (
      <ExtractEmailContentWithActionEditor
        description={description}
        actionEntity={actionEntity}
        onExtractEmailContentConfirm={onExtractEmailContentConfirm}
        onExtractEmailContentCancel={onExtractEmailContentCancel}
        readOnly={!enabled}
      />
    );
  }

  if (isWaitUntilAction) {
    // Extract wait condition details from action_entity if available
    const condition = actionEntity?.action_data?.kwargs?.condition || '';
    const timeoutSeconds = actionEntity?.action_data?.kwargs?.timeout_seconds || 60;

    return (
      <WaitUntilEditor
        condition={condition}
        timeoutSeconds={timeoutSeconds}
        onWaitUntilConfirm={onWaitUntilConfirm}
        readOnly={!enabled}
      />
    );
  }

  if (isAssertionAction) {
    return (
      <AssertionEditor
        description={description}
        onDescriptionChange={handleDescriptionChange}
        placeholder={getPlaceholder()}
        emptyText={getEmptyText()}
        enabled={enabled}
      />
    );
  }

  // Default to basic action editor
  return (
    <BasicActionEditor
      description={description}
      onDescriptionChange={handleDescriptionChange}
      onFindElement={onFindElement}
      placeholder={getPlaceholder()}
      emptyText={getEmptyText()}
      enabled={enabled}
    />
  );
};
