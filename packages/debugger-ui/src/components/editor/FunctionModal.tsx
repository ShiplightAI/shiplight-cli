import React, { useState, useEffect } from "react";
import { Modal, Text, Group, TextInput, Loader, Divider, Stack, Stepper, Button } from "@mantine/core";
import { useTranslations } from "next-intl";
import { TestFunction } from "@/common/models/testFunction";
import { IconSearch, IconFunction } from "@tabler/icons-react";
import { TestFunctionStatus } from "@/common/constants";
import { isSystemParameter, parseFunctionParameters, separateParameters } from "@/common/utils/functionUtils";

interface FunctionModalProps {
  opened: boolean;
  onClose: () => void;
  onSelectFunction: (func: TestFunction, paramValues?: Record<string, string>) => void;
  functions: TestFunction[];
  isLoading?: boolean;
}

const displayName = (name: string) => name.includes("#") ? name.split("#")[1] : name;

const FunctionModal: React.FC<FunctionModalProps> = ({
  opened,
  onClose,
  onSelectFunction,
  functions,
  isLoading = false,
}) => {
  const t = useTranslations("Editor.functionModal");
  // Function selection state
  const [searchQuery, setSearchQuery] = useState("");
  const [filteredFunctions, setFilteredFunctions] = useState<TestFunction[]>([]);
  const [hoveredItemId, setHoveredItemId] = useState<number | null>(null);
  const [activeStep, setActiveStep] = useState(0);

  // Function parameters state
  const [selectedFunction, setSelectedFunction] = useState<TestFunction | null>(null);
  const [systemParams, setSystemParams] = useState<string[]>([]);
  const [customParams, setCustomParams] = useState<string[]>([]);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset state when modal is opened/closed
  useEffect(() => {
    if (!opened) {
      setActiveStep(0);
      setSelectedFunction(null);
      setSystemParams([]);
      setCustomParams([]);
      setParamValues({});
      setSearchQuery("");
    }
  }, [opened]);

  // Filter active functions when search query or functions list changes
  useEffect(() => {
    // Filter to only show active functions
    const activeFunctions = functions.filter((func: TestFunction) => func.status === TestFunctionStatus.Active);

    if (!searchQuery.trim()) {
      setFilteredFunctions(activeFunctions);
      return;
    }

    const query = searchQuery.toLowerCase();
    const filtered = activeFunctions.filter(
      (func: TestFunction) =>
        func.name.toLowerCase().includes(query) || (func.description && func.description.toLowerCase().includes(query)),
    );

    setFilteredFunctions(filtered);
  }, [searchQuery, functions]);

  // Function to analyze and extract parameters from function code
  const analyzeFunction = (func: TestFunction) => {
    if (!func || !func.code) {
      console.warn("Function code is missing or empty");
      return {
        systemParams: [],
        customParams: [],
        initialValues: {},
      };
    }

    try {
      // Parse parameters from function code
      const allParams = parseFunctionParameters(func.code);

      // Separate system parameters from custom parameters
      const { systemParams, customParams } = separateParameters(allParams);

      // Initialize parameter values
      const initialValues: Record<string, string> = {};

      // Maintain the order of parameters
      for (const param of allParams) {
        if (isSystemParameter(param)) {
          initialValues[param] = param;
        } else {
          initialValues[param] = "";
        }
      }

      return {
        systemParams,
        customParams,
        initialValues,
      };
    } catch (error) {
      console.error("Error analyzing function:", error);
      return {
        systemParams: [],
        customParams: [],
        initialValues: {},
      };
    }
  };

  // When user selects a function in the first step
  const handleSelectFunction = (func: TestFunction) => {
    try {
      if (!func) {
        console.error("Invalid function selection");
        return;
      }

      // Set the selected function
      setSelectedFunction(func);

      // Analyze the function and extract parameters
      const { systemParams, customParams, initialValues } = analyzeFunction(func);

      // Update state with the extracted parameters
      setSystemParams(systemParams || []);
      setCustomParams(customParams || []);
      setParamValues(initialValues || {});

      // Move to the parameters configuration step
      setTimeout(() => {
        setActiveStep(1);
      }, 50);
    } catch (error) {
      console.error("Error selecting function:", error);
      // Set default values and still try to proceed
      setSystemParams([]);
      setCustomParams([]);
      setParamValues({});

      // Still try to move to the next step
      setTimeout(() => {
        setActiveStep(1);
      }, 50);
    }
  };

  // When user changes a parameter value in the second step
  const handleParamChange = (param: string, value: string) => {
    // Update the parameter value
    setParamValues((prev) => ({
      ...prev,
      [param]: value,
    }));
  };

  // When user clicks the back button
  const handleBack = () => {
    setActiveStep(0);
  };

  // When user confirms the function selection with parameters
  const handleConfirm = () => {
    setIsSubmitting(true);
    try {
      if (selectedFunction) {
        onSelectFunction(selectedFunction, paramValues);
        onClose();
      }
    } catch (error) {
      console.error("Error confirming function selection:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <IconFunction size={20} />
          <Text fw={500}>
            {activeStep === 0 ? t("titleStep0") : t("titleStep1", { name: displayName(selectedFunction?.name ?? "") })}
          </Text>
        </Group>
      }
      size="xl"
      styles={{
        content: {
          maxWidth: "750px",
          width: "750px",
        },
      }}
    >
      <div className="px-0">
        <div className="my-4 px-12">
          <Stepper active={activeStep} onStepClick={setActiveStep}>
            <Stepper.Step label={t("step0Label")} description={t("step0Description")} />
            <Stepper.Step
              label={t("step1Label")}
              description={selectedFunction ? displayName(selectedFunction.name) : t("step1Description")}
            />
          </Stepper>
        </div>

        {activeStep === 0 ? (
          <div className="p-4">
            {/* Search input */}
            <TextInput
              placeholder={t("searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.currentTarget.value)}
              leftSection={<IconSearch size={16} />}
              mb={16}
            />

            {isLoading ? (
              <div className="flex justify-center items-center py-8">
                <Loader size="md" />
              </div>
            ) : filteredFunctions.length === 0 ? (
              <Text c="dimmed" ta="center" py="xl">
                {t("noFunctionsFound")}
              </Text>
            ) : (
              <div>
                {/* Header row */}
                <div className="flex font-medium py-2 px-4 border-b border-secondary bg-secondary">
                  <div className="w-2/5">{t("columnName")}</div>
                  <div className="w-3/5">{t("columnDescription")}</div>
                </div>

                {/* Function list */}
                <div className="max-h-[350px] overflow-y-auto border-secondary">
                  {filteredFunctions.map((func) => (
                    <div
                      key={func.id}
                      className={`flex px-4 py-3 border-b border-secondary hover:bg-surface-hover cursor-pointer transition-colors ${
                        hoveredItemId === func.id ? "bg-secondary" : ""
                      }`}
                      onMouseEnter={() => setHoveredItemId(func.id)}
                      onMouseLeave={() => setHoveredItemId(null)}
                      onClick={() => handleSelectFunction(func)}
                    >
                      <div className="w-2/5">
                        <Text fw={500} className="truncate">
                          {displayName(func.name)}
                        </Text>
                      </div>
                      <div className="w-3/5">
                        <Text size="sm" className="truncate">
                          {func.description || t("noDescription")}
                        </Text>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          selectedFunction && (
            <div className="p-6">
              {/* Parameters section */}
              <div className="mb-6">
                {/* Custom Parameters */}
                {customParams.length > 0 ? (
                  <div>
                    <Text className="section-title" mb="xs">
                      {t("parametersTitle")}
                    </Text>

                    {customParams.map((param) => (
                      <Group key={param} mb="sm" grow>
                        <Text size="sm" fw={500} className="w-1/3">
                          {param}
                        </Text>
                        <TextInput
                          placeholder={t("paramValuePlaceholder")}
                          value={paramValues[param] || ""}
                          onChange={(e) => handleParamChange(param, e.currentTarget.value)}
                          className="w-2/3"
                        />
                      </Group>
                    ))}
                  </div>
                ) : (
                  <Text size="sm" c="dimmed" ta="center" className="my-4">
                    {t("noCustomParams")}
                  </Text>
                )}
              </div>

              {/* Action buttons */}
              <Group justify="flex-end" className="mt-6 pt-3 border-t border-secondary">
                <Button variant="subtle" onClick={handleBack} disabled={isSubmitting}>
                  {t("back")}
                </Button>
                <Button loading={isSubmitting} onClick={handleConfirm} disabled={isSubmitting}>
                  {t("confirm")}
                </Button>
              </Group>
            </div>
          )
        )}
      </div>
    </Modal>
  );
};

export default FunctionModal;
