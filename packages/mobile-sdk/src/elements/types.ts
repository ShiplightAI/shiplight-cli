/**
 * Mobile Element Types
 * Types for representing UI elements extracted from the accessibility tree.
 */

/**
 * Bounds of an element on screen
 */
export interface ElementBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * A mobile UI element extracted from the accessibility tree
 */
export interface MobileElement {
  /** Sequential index assigned during extraction [0], [1], [2]... */
  index: number;

  /** Full Android class name (e.g., "android.widget.Button") */
  className: string;

  /** Simplified display type (e.g., "Button", "TextField", "Image") */
  displayType: string;

  /** Visible text content */
  text: string;

  /** Android resource ID (e.g., "com.app:id/login_button") */
  resourceId: string;

  /** Accessibility content description */
  contentDesc: string;

  /** Element bounds on screen */
  bounds: ElementBounds;

  /** Whether the element is clickable */
  clickable: boolean;

  /** Whether the element is scrollable */
  scrollable: boolean;

  /** Whether the element is enabled */
  enabled: boolean;

  /** Whether the element is focusable */
  focusable: boolean;

  /** App package name */
  packageName: string;
}

/**
 * Result of element extraction
 */
export interface ElementExtractionResult {
  /** Interactive elements with assigned indices */
  elements: MobileElement[];

  /** Total number of nodes in the hierarchy */
  totalNodes: number;

  /** Number of interactive elements found */
  interactiveCount: number;

  /** Time taken to extract elements in ms */
  extractionTimeMs: number;
}

/**
 * Get the center point of an element's bounds
 */
export function getElementCenter(bounds: ElementBounds): { x: number; y: number } {
  return {
    x: Math.round((bounds.left + bounds.right) / 2),
    y: Math.round((bounds.top + bounds.bottom) / 2),
  };
}

/**
 * Check if bounds are valid (non-zero area, non-negative)
 */
export function isValidBounds(bounds: ElementBounds): boolean {
  return (
    bounds.right > bounds.left &&
    bounds.bottom > bounds.top &&
    bounds.left >= 0 &&
    bounds.top >= 0
  );
}

/**
 * Simplify Android class name to a readable display type
 */
export function simplifyClassName(className: string): string {
  // Extract just the class name without package
  const simpleName = className.split('.').pop() || className;

  // Map common Android widget names to simpler types
  const typeMap: Record<string, string> = {
    Button: 'Button',
    ImageButton: 'Button',
    FloatingActionButton: 'Button',
    MaterialButton: 'Button',
    AppCompatButton: 'Button',
    EditText: 'TextField',
    TextInputEditText: 'TextField',
    AppCompatEditText: 'TextField',
    AutoCompleteTextView: 'TextField',
    TextView: 'Text',
    AppCompatTextView: 'Text',
    ImageView: 'Image',
    AppCompatImageView: 'Image',
    CheckBox: 'Checkbox',
    AppCompatCheckBox: 'Checkbox',
    Switch: 'Switch',
    SwitchCompat: 'Switch',
    RadioButton: 'RadioButton',
    AppCompatRadioButton: 'RadioButton',
    ScrollView: 'ScrollView',
    HorizontalScrollView: 'ScrollView',
    NestedScrollView: 'ScrollView',
    RecyclerView: 'List',
    ListView: 'List',
    GridView: 'Grid',
    ViewPager: 'Pager',
    ViewPager2: 'Pager',
    FrameLayout: 'Container',
    LinearLayout: 'Container',
    RelativeLayout: 'Container',
    ConstraintLayout: 'Container',
    CoordinatorLayout: 'Container',
    View: 'View',
    ViewGroup: 'Container',
    WebView: 'WebView',
    SearchView: 'SearchField',
    Spinner: 'Dropdown',
    SeekBar: 'Slider',
    ProgressBar: 'Progress',
    TabLayout: 'TabBar',
    TabItem: 'Tab',
    BottomNavigationView: 'NavBar',
    NavigationView: 'NavMenu',
    Toolbar: 'Toolbar',
    ActionBar: 'Toolbar',
  };

  return typeMap[simpleName] || simpleName;
}
