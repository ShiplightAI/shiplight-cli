/**
 * Central export point for all actions
 * Each action is in its own file with action implementation + LLM tool schema + registration
 */

// Export types
export * from './types';

// Export utilities
export * from './utils';
export * from './actionHelper';

// Navigation actions
export * from './impl/done';
export * from './impl/go_back';
export * from './impl/go_to_url';
export * from './impl/reload_page';
export * from './impl/wait';

// Mouse actions
export * from './impl/click';
export * from './impl/click_by_coordinates';
export * from './impl/double_click';
export * from './impl/double_click_by_coordinates';
export * from './impl/drag_drop';
export * from './impl/hover';
export * from './impl/right_click';
export * from './impl/right_click_by_coordinates';

// Input actions
export * from './impl/clear_input';
export * from './impl/input_text';
export * from './impl/press';

// Scroll actions
export * from './impl/scroll';
export * from './impl/scroll_on_element';
export * from './impl/scroll_to_text';

// Tab actions
export * from './impl/close_tab';
export * from './impl/switch_tab';

// File actions
export * from './impl/upload_file';
export * from './impl/wait_for_download_complete';

// Form actions
export * from './impl/get_dropdown_options';
export * from './impl/select_dropdown_option';
export * from './impl/set_date_for_native_date_picker';

// AI actions
export * from './impl/ai_action';
export * from './impl/ai_assert';
export * from './impl/ai_extract';
export * from './impl/ai_step';
export * from './impl/wait_until';

// Auth actions
export * from './impl/generate_2fa_code';

// Utility actions
export * from './impl/function';
export * from './impl/js_code';
export * from './impl/save_variable';

// Export handler (unified action execution and transpilation)
export * from './handler';
