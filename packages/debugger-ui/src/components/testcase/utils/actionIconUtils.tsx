import { TestStepActionType } from "@/common/constants";
import {
  IconArrowBack,
  IconBrain,
  IconBrowserPlus,
  IconBrowserX,
  IconCalendar,
  IconCheck,
  IconClick,
  IconClock,
  IconCode,
  IconCursorText,
  IconDeviceFloppy,
  IconDownload,
  IconEye,
  IconFileText,
  IconFunction,
  IconHandMove,
  IconKeyboard,
  IconKeyboardShow,
  IconList,
  IconMouse,
  IconPencil,
  IconSelect,
  IconSwitchHorizontal,
  IconUpload,
  IconWand,
  IconWorld,
  IconLogin,
  IconMail,
} from "@tabler/icons-react";

// Helper to detect specific action from description
export const detectSpecificAction = (description: string): string | null => {
  description = description.toLowerCase();

  if (description.match(/^click/)) {
    return "click";
  } else if (description.match(/^right click/)) {
    return "click";
  } else if (description.match(/^press/)) {
    return "press";
  } else if (description.match(/^select/)) {
    return "select";
  } else if (description.match(/^set date/)) {
    return "set_date_for_native_date_picker";
  } else if (description.match(/^type|^enter|^input|^fill|^write/)) {
    return "fill";
  } else if (description.match(/^scroll|^move/)) {
    return "scroll";
  } else if (description.match(/^upload/)) {
    return "upload";
  } else if (description.match(/^navigate|^go to|^visit|^open|^browse/)) {
    return "navigate";
  } else if (description.match(/^wait|^delay|^pause|^sleep/)) {
    return "wait";
  } else if (description.match(/^hover/)) {
    return "hover";
  } else if (description.match(/^drag|^drop/)) {
    return "drag_drop";
  } else if (description.match(/^extract/)) {
    return "extract_content";
  } else if (description.match(/^download/)) {
    return "click_download_button";
  } else if (description.match(/^go back|^back/)) {
    return "go_back";
  }
  // TODO: whether to auto detect login action
  // else if (description.match(/^login|^sign in|^log in|^authenticate/)) {
  //   return "login";
  // }

  return null;
};

// Helper function to detect action name from description
export const detectActionName = (description: string, actionType?: string, actionMode?: string): string => {
  // If action type is already specified as Assert, return ai_assert
  if (actionType === TestStepActionType.Assertion) {
    return "ai_assert"; // Always return ai_assert for assertions
  }

  if (actionType === TestStepActionType.Code) {
    return "js_code";
  }

  // For Interact with Dynamic mode, return ai_action
  if (actionType === TestStepActionType.AiAction) {
    return "ai_action";
  }

  // Otherwise, detect specific action from description
  const specificAction = detectSpecificAction(description);
  if (specificAction) {
    return specificAction;
  }

  // Default to generic action if no match
  return "action";
};

// Helper to get action type from action name
export const getActionTypeFromActionName = (name: string): string => {
  if (name === "assert" || name === "ai_assert" || name === "verify") {
    return TestStepActionType.Assertion;
  } else if (name === "js_code") {
    return TestStepActionType.Code;
  } else if (name === "function") {
    return TestStepActionType.Function;
  } else if (name === "upload_file") {
    return TestStepActionType.UploadFile;
  } else if (name === "ai_extract") {
    return TestStepActionType.ExtractContent;
  } else if (name === "ai_action") {
    return TestStepActionType.AiAction;
  } else if (name === "login") {
    return TestStepActionType.Login;
  } else if (name === "extract_email_content") {
    return TestStepActionType.ExtractEmailContent;
  } else if (name === "ai_wait_until") {
    return TestStepActionType.WaitUntil;
  } else {
    return TestStepActionType.Action;
  }
};

// Get action icon based on type and description
export const getActionIcon = (type: string, description?: string): JSX.Element => {
  // For draft type, return pencil icon
  if (type === "draft") {
    return <IconPencil size={14} />;
  }

  // For assertion types, return assertion icon
  if (type === TestStepActionType.Assertion || type === "assert" || type === "ai_assert") {
    return <IconCheck size={14} />;
  }

  // For JS Code, return code icon
  if (type === TestStepActionType.Code || type === "js_code") {
    return <IconCode size={14} />;
  }

  // For JS Action (cached JS with self-healing), detect from description or fallback to code icon
  if (type === "js_action") {
    if (description) {
      const specificAction = detectSpecificAction(description);
      if (specificAction) {
        return getActionIcon(specificAction, description);
      }
    }
    return <IconCode size={14} />;
  }

  // For Function, return function icon
  if (type === TestStepActionType.Function || type === "function") {
    return <IconFunction size={14} />;
  }

  // For Upload File, return upload icon
  if (type === TestStepActionType.UploadFile || type === "upload_file") {
    return <IconUpload size={14} />;
  }

  // For Extract Content, return save icon
  if (type === TestStepActionType.ExtractContent || type === "ai_extract") {
    return <IconDeviceFloppy size={14} />;
  }

  // For Login, return login icon
  if (type === TestStepActionType.Login || type === "login") {
    return <IconLogin size={14} />;
  }

  // For Extract Email Content, return mail icon
  if (type === TestStepActionType.ExtractEmailContent || type === "extract_email_content") {
    return <IconMail size={14} />;
  }

  // For Wait Until, return clock icon
  if (type === TestStepActionType.WaitUntil || type === "ai_wait_until") {
    return <IconClock size={14} />;
  }

  // For action types (action or ai_action), try to detect specific action if description is provided
  if ((type === TestStepActionType.Action || type === "action") && description) {
    const specificAction = detectSpecificAction(description);
    if (specificAction) {
      // Use the specific action icon if found
      type = specificAction;
    } else {
      // Use wand icon for generic action
      return <IconWand size={14} />;
    }
  }

  if (type === TestStepActionType.AiAction || type === "ai_action") {
    // first detect specific action from description
    const specificAction = detectSpecificAction(description || "");
    if (specificAction) {
      return getActionIcon(specificAction, description);
    }
    // if no specific action, return wand icon
    return <IconWand size={14} />;
  }

  // Map for specific action icons
  const iconMap: Record<string, JSX.Element> = {
    // Click actions
    click: <IconClick size={14} />,
    click_element: <IconClick size={14} />,
    click_element_by_index: <IconClick size={14} />,
    click_download_button: <IconDownload size={14} />,
    click_by_coordinates: <IconClick size={14} />,
    right_click_by_coordinates: <IconClick size={14} />,
    double_click_by_coordinates: <IconClick size={14} />,
    // Keyboard actions
    press: <IconKeyboardShow size={14} />,
    send_keys: <IconKeyboardShow size={14} />,
    send_keys_on_element: <IconKeyboardShow size={14} />,
    // Fill/type actions
    fill: <IconKeyboard size={14} />,
    input_text: <IconKeyboard size={14} />,
    // Scroll actions
    scroll: <IconMouse size={14} />,
    scroll_down: <IconMouse size={14} />,
    scroll_up: <IconMouse size={14} />,
    scroll_on_element: <IconMouse size={14} />,
    scroll_to_text: <IconMouse size={14} />,
    // Navigation actions
    navigate: <IconWorld size={14} />,
    go_to_url: <IconWorld size={14} />,
    go_back: <IconArrowBack size={14} />,
    // Selection actions
    select: <IconSelect size={14} />,
    select_dropdown_option: <IconSelect size={14} />,
    // Date actions
    set_date_for_native_date_picker: <IconCalendar size={14} />,
    // Wait actions
    wait: <IconClock size={14} />,
    // Upload actions
    upload: <IconUpload size={14} />,
    upload_file: <IconUpload size={14} />,
    // Hover actions
    hover: <IconEye size={14} />,
    hover_element_by_index: <IconEye size={14} />,
    // Mouse actions
    mouse_move: <IconMouse size={14} />,
    // Drag and drop
    drag_drop: <IconHandMove size={14} />,
    // Tab actions
    open_tab: <IconBrowserPlus size={14} />,
    close_tab: <IconBrowserX size={14} />,
    switch_tab: <IconSwitchHorizontal size={14} />,
    // Extract content
    extract_content: <IconFileText size={14} />,
    // AI actions
    ai_step: <IconList size={14} />,
    ai_action: <IconBrain size={14} />,
    ai_assert: <IconCheck size={14} />,
    verify: <IconCheck size={14} />,

    // Extract content
    ai_extract: <IconDeviceFloppy size={14} />,

    // Login
    login: <IconLogin size={14} />,

    // JS Action (cached JS with self-healing)
    js_action: <IconCode size={14} />,

    // Done
    done: <IconCheck size={14} />,
    // Draft
    draft: <IconPencil size={14} />,
    // Default fallback
    default: <IconCursorText size={14} />,
  };

  return iconMap[type] || iconMap["default"];
};

// Get display name for badge based on action name and description
export const getDisplayActionName = (actionName: string, description: string, actionEntity?: any): string => {
  // For Draft - show "DRAFT" badge
  if (actionName === "draft") {
    return "DRAFT";
  }

  // For Function - show function name in uppercase
  if (actionName === "function") {
    // First try to get function name from action_entity kwargs
    if (actionEntity?.action_data?.kwargs?.functionName) {
      const ref: string = actionEntity.action_data.kwargs.functionName;
      const display = ref.includes("#") ? ref.split("#")[1] : ref;
      return display.toUpperCase();
    }

    // Fallback: try to extract function name from the description
    // Support both "Call function" and "call function" (case insensitive)
    // Match patterns like "call function login(...)" or "call function login"
    const match = description.match(/(?:call|Call)\s+function\s+([^(]+?)(?:\(|$)/i);
    if (match && match[1]) {
      const functionName = match[1].trim();
      if (functionName) {
        return functionName.toUpperCase();
      }
    }

    // If description is just "call function" without a name, still return "FUNCTION"
    if (description.toLowerCase().includes("call function")) {
      return "FUNCTION";
    }

    // If we couldn't find it, just return "FUNCTION"
    return "FUNCTION";
  }

  if (actionName === "ai_step") {
    return "AI GROUP";
  }

  if (actionName === "ai_wait_until") {
    return "WAIT UNTIL";
  }

  if (actionName === "assert" || actionName === "ai_assert" || actionName === "verify") {
    return "ASSERTION";
  }

  // Map for unified action labels
  const labelMap: Record<string, string> = {
    // Click actions
    click: "CLICK",
    click_element: "CLICK",
    click_element_by_index: "CLICK",
    click_download_button: "DOWNLOAD",
    click_by_coordinates: "CLICK",
    right_click_by_coordinates: "CLICK",
    double_click_by_coordinates: "CLICK",

    // Keyboard actions
    press: "PRESS",
    send_keys: "PRESS",
    send_keys_on_element: "PRESS",

    // Fill/type actions
    fill: "FILL",
    input_text: "FILL",

    // Scroll actions
    scroll: "SCROLL",
    scroll_down: "SCROLL",
    scroll_up: "SCROLL",
    scroll_on_element: "SCROLL",
    scroll_to_text: "SCROLL",
    scroll_element: "SCROLL",

    // Navigation actions
    navigate: "NAVIGATE",
    go_to_url: "NAVIGATE",
    go_back: "BACK",

    // Selection actions
    select: "SELECT",
    select_dropdown_option: "SELECT",

    // Date actions
    set_date_for_native_date_picker: "SET DATE",

    // Wait actions
    wait: "WAIT",

    // Upload actions
    upload: "UPLOAD",
    upload_file: "UPLOAD",

    // Hover actions
    hover: "HOVER",
    hover_element_by_index: "HOVER",

    // Mouse actions
    mouse_move: "MOVE",

    // Drag and drop
    drag_drop: "DRAG",

    // Tab actions
    open_tab: "OPEN TAB",
    close_tab: "CLOSE TAB",
    switch_tab: "SWITCH TAB",

    // Extract content
    extract_content: "EXTRACT",

    // Extract actions
    ai_extract: "EXTRACT",

    // AI actions
    ai_action: "ACTION",
    ai_step: "AI GROUP",
    ai_wait_until: "WAIT UNTIL",

    // Verification
    assert: "ASSERTION",
    ai_assert: "ASSERTION",
    verify: "ASSERTION",

    // Done
    done: "DONE",

    // Code
    js_code: "CODE",
    js_action: "ACTION",
  };

  // If we have a direct mapping for the known action name, use it
  // (skip generic names like "action" — those should fall through to description detection)
  if (actionName !== "action" && labelMap[actionName]) {
    return labelMap[actionName];
  }

  // For generic action names, try to resolve a more specific label from the description
  const specificAction = detectSpecificAction(description);
  if (specificAction && labelMap[specificAction]) {
    return labelMap[specificAction];
  }

  // Fallback to the direct mapping for generic names
  if (labelMap[actionName]) {
    return labelMap[actionName];
  }

  // Default to uppercase action name if no mapping found
  return actionName.toUpperCase();
};

// Helper to get badge class based on action type
export const getBadgeClass = (actionName: string): string => {
  const actionType = getActionTypeFromActionName(actionName);
  switch (actionType) {
    case TestStepActionType.AiAction:
      return "badge-ai-action";
    case TestStepActionType.Assertion:
      return "badge-assert";
    case TestStepActionType.Code:
      return "badge-code";
    case TestStepActionType.Function:
      return "badge-function";
    case TestStepActionType.ExtractContent:
      return "badge-extract";
    case TestStepActionType.WaitUntil:
      return "badge-wait-until";
    default:
      return "badge-action";
  }
};

// Helper to get badge color for StatementBadge based on action type
export const getBadgeColorForActionType = (actionName: string): string => {
  // Special case for draft - use orange color to indicate it's transient
  if (actionName === "draft") {
    return "bg-orange-600"; // Orange for draft - stands out as transient
  }

  const actionType = getActionTypeFromActionName(actionName);
  switch (actionType) {
    case TestStepActionType.AiAction:
      return "bg-violet-700"; // Matches --shiplight-badge-ai-action-bg (violet-7)
    case TestStepActionType.Assertion:
      return "bg-teal-700"; // Matches --shiplight-badge-assert-bg (teal-7)
    case TestStepActionType.Code:
      return "bg-cyan-700"; // Matches --shiplight-badge-code-bg (cyan-7)
    case TestStepActionType.Function:
      return "bg-indigo-700"; // Matches --shiplight-badge-function-bg (indigo-7)
    case TestStepActionType.UploadFile:
      return "bg-gray-900"; // Normal color for upload file action
    case TestStepActionType.ExtractContent:
      return "bg-green-700"; // Green color for extract content action
    case TestStepActionType.WaitUntil:
      return "bg-purple-700"; // Purple color for AI wait until action
    default:
      switch (actionName) {
        case "ai_step":
          return "bg-blue-700"; // Matches --shiplight-badge-step-bg (blue-7)
        case "js_action":
          return "bg-emerald-700"; // Cached JS with self-healing
        default:
          return "bg-gray-900"; // Matches --shiplight-badge-action-bg (dark-9)
      }
  }
};
