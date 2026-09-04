(
  args = {
    doHighlightElements: true,
    focusHighlightIndex: -1,
    viewportExpansion: 0,
    debugMode: false,
    interactiveClassNames: [],
    alwaysHighlightFileInput: false,
    domTreeRoot: "body",
    initialHighlightIndex: 0,
  }
) => {
  const SEMANTIC_ATTRIBUTES = ['data-testid', 'data-test-id'];
  const EVENT_LISTENER_MAPPING = {
    'onclick': 'click',
    'onmousedown': 'mousedown',
    'onmouseup': 'mouseup',
    'ondblclick': 'dblclick',
    'onmouseenter': 'mouseenter',
    'onmouseleave': 'mouseleave',
    'onmousemove': 'mousemove',
    'onmouseout': 'mouseout',
    'onmouseover': 'mouseover',
    'onmouseup': 'mouseup',
    'onmousewheel': 'mousewheel',
    'onscroll': 'scroll',
    'onselect': 'select',
    'onchange': 'change',
    'onfocus': 'focus',
    'onblur': 'blur',
    'onkeydown': 'keydown',
    'onkeyup': 'keyup',
    'onkeypress': 'keypress',
    'oninput': 'input',
  }

  const INTERACTION_EVENTS = ['click', 'mousedown', 'mouseup', 'dblclick', 'input', 'mouseenter', 'mouseleave'];

  const {
    doHighlightElements,
    focusHighlightIndex,
    viewportExpansion,
    debugMode,
    interactiveClassNames,
    alwaysHighlightFileInput,
    domTreeRoot,
    initialHighlightIndex = 0,
  } = args;

  const buttonClassNames = ['button', 'dropdown-toggle'];
  const heuristicClassPattern = /\b(btn|const clickable|menu|item|entry|link)\b/i;
  const containerSelectors = 'button,a,[role="button"],.menu,.dropdown,.list,.toolbar';

  let highlightIndex = initialHighlightIndex;

  /**
   * Helper function to check if element has any of the specified class names.
   *
   * @param {HTMLElement} element - The element to check.
   * @param {string[]} classNames - Array of class names to check for.
   * @returns {boolean} Whether the element has any of the specified class names.
   */
  function hasAnyClassName(element, classNames) {
    if (!element.classList || !classNames || classNames.length === 0) return false;
    return classNames.some(className => element.classList.contains(className));
  }

  // Add caching mechanisms at the top level
  const DOM_CACHE = {
    boundingRects: new WeakMap(),
    clientRects: new WeakMap(),
    computedStyles: new WeakMap(),
    nodeEventListeners: new WeakMap(),
    clearCache: () => {
      DOM_CACHE.boundingRects = new WeakMap();
      DOM_CACHE.clientRects = new WeakMap();
      DOM_CACHE.computedStyles = new WeakMap();
      DOM_CACHE.nodeEventListeners = new WeakMap();
    }
  };

  /**
   * Gets the cached bounding rect for an element.
   *
   * @param {HTMLElement} element - The element to get the bounding rect for.
   * @returns {DOMRect | null} The cached bounding rect, or null if the element is not found.
   */
  function getCachedBoundingRect(element) {
    if (!element) return null;

    if (DOM_CACHE.boundingRects.has(element)) {
      return DOM_CACHE.boundingRects.get(element);
    }

    const rect = element.getBoundingClientRect();

    if (rect) {
      DOM_CACHE.boundingRects.set(element, rect);
    }
    return rect;
  }

  /**
   * Gets the cached computed style for an element.
   *
   * @param {HTMLElement} element - The element to get the computed style for.
   * @returns {CSSStyleDeclaration | null} The cached computed style, or null if the element is not found.
   */
  function getCachedComputedStyle(element) {
    if (!element) return null;

    if (DOM_CACHE.computedStyles.has(element)) {
      return DOM_CACHE.computedStyles.get(element);
    }

    const style = window.getComputedStyle(element);

    if (style) {
      DOM_CACHE.computedStyles.set(element, style);
    }
    return style;
  }

  /**
   * Gets the cached client rects for an element.
   *
   * @param {HTMLElement} element - The element to get the client rects for.
   * @returns {DOMRectList | null} The cached client rects, or null if the element is not found.
   */
  function getCachedClientRects(element) {
    if (!element) return null;

    if (DOM_CACHE.clientRects.has(element)) {
      return DOM_CACHE.clientRects.get(element);
    }

    const rects = element.getClientRects();

    if (rects) {
      DOM_CACHE.clientRects.set(element, rects);
    }
    return rects;
  }

  /**
   * Gets the event listeners for a node.
   *
   * @param {HTMLElement} element - The element to get the event listeners for.
   * @returns {string[]} The event listeners for the element.
   */
  function getNodeEventListeners(element) {
    const set = new Set();
    try  {
      if (typeof getEventListeners === 'function') {
        const listeners = getEventListeners(element);
        for (const eventType in listeners) {
          if (listeners[eventType] && listeners[eventType].length > 0) {
            set.add(eventType);
          }
        }
      }

      const getEventListenersForNode = element?.ownerDocument?.defaultView?.getEventListenersForNode || window.getEventListenersForNode;
      if (typeof getEventListenersForNode === 'function') {
        const listeners = getEventListenersForNode(element);
        for (const listener of listeners) {
          if (listener.type) {
            set.add(listener.type);
          }
        }
      }

      for (const attr in EVENT_LISTENER_MAPPING) {
        if (element.hasAttribute(attr) || typeof element[attr] === 'function') {
          set.add(EVENT_LISTENER_MAPPING[attr]);
        }
      }
    } catch (error) {
    }

    const listenedEvents = Array.from(set);
    return listenedEvents;
  }

  function getCachedNodeEventListeners(element) {
    if (!element) return null;
    if (DOM_CACHE.nodeEventListeners.has(element)) {
      return DOM_CACHE.nodeEventListeners.get(element);
    }
    const listenedEvents = getNodeEventListeners(element);
    if (listenedEvents) {
      DOM_CACHE.nodeEventListeners.set(element, listenedEvents);
    }
    return listenedEvents;
  }

  /**
   * Hash map of DOM nodes indexed by their highlight index.
   *
   * @type {Object<string, any>}
   */
  const DOM_HASH_MAP = {};

  const ID = { current: 0 };

  const HIGHLIGHT_CONTAINER_ID = "playwright-highlight-container";

  // Add a WeakMap cache for XPath strings
  const xpathCache = new WeakMap();

  const existingLabelBoundingBoxes = [];

  /**
   * Highlights an element in the DOM and returns the index of the next element.
   *
   * @param {HTMLElement} element - The element to highlight.
   * @param {number} index - The index of the element.
   * @param {HTMLElement | null} parentIframe - The parent iframe node.
   * @returns {number} The index of the next element.
   */
  function highlightElement(element, index, parentIframe = null) {
    if (!element) return index;

    const overlays = [];
    /**
     * @type {HTMLElement | null}
     */
    let label = null;
    let labelWidth = 20;
    let labelHeight = 16;
    let cleanupFn = null;

    try {
      // Create or get highlight container
      let container = document.getElementById(HIGHLIGHT_CONTAINER_ID);
      if (!container) {
        container = document.createElement("div");
        container.id = HIGHLIGHT_CONTAINER_ID;
        container.style.position = "fixed";
        container.style.pointerEvents = "none";
        container.style.top = "0";
        container.style.left = "0";
        container.style.width = "100%";
        container.style.height = "100%";
        // Use the maximum valid value in zIndex to ensure the element is not blocked by overlapping elements.
        container.style.zIndex = "2147483647";
        container.style.backgroundColor = 'transparent';
        document.body.appendChild(container);
      }

      // Get element client rects
      let rects = element.getClientRects(); // Use getClientRects()

      if (!rects || rects.length === 0) return index; // Exit if no rects

      // If element is inside an iframe, we need to transform the rects to main document coordinates
      if (parentIframe) {
        const transformedRects = [];
        const iframeRect = parentIframe.getBoundingClientRect();

        // Get iframe's content area offset and CSS transforms
        const iframeStyle = window.getComputedStyle(parentIframe);
        const borderLeft = parseFloat(iframeStyle.borderLeftWidth) || 0;
        const borderTop = parseFloat(iframeStyle.borderTopWidth) || 0;
        const paddingLeft = parseFloat(iframeStyle.paddingLeft) || 0;
        const paddingTop = parseFloat(iframeStyle.paddingTop) || 0;

        const contentOffsetX = borderLeft + paddingLeft;
        const contentOffsetY = borderTop + paddingTop;

        // Extract scale factor from CSS transform
        let scaleX = 1, scaleY = 1;
        const transform = iframeStyle.transform;
        if (transform && transform !== 'none') {
          // Parse scale from transform matrix or scale() function
          const scaleMatch = transform.match(/scale\(([^)]+)\)/);
          if (scaleMatch) {
            const scaleValues = scaleMatch[1].split(',').map(v => parseFloat(v.trim()));
            scaleX = scaleValues[0] || 1;
            scaleY = scaleValues[1] || scaleX; // If only one value, use it for both X and Y
          } else {
            // Try to parse matrix() transform
            const matrixMatch = transform.match(/matrix\(([^)]+)\)/);
            if (matrixMatch) {
              const values = matrixMatch[1].split(',').map(v => parseFloat(v.trim()));
              if (values.length >= 6) {
                scaleX = values[0]; // a value in matrix(a, b, c, d, e, f)
                scaleY = values[3]; // d value in matrix(a, b, c, d, e, f)
              }
            }
          }
        }

        // Get iframe scroll position
        let scrollLeft = 0, scrollTop = 0;
        try {
          const iframeDoc = parentIframe.contentDocument || parentIframe.contentWindow?.document;
          if (iframeDoc) {
            scrollLeft = iframeDoc.documentElement?.scrollLeft || iframeDoc.body?.scrollLeft || 0;
            scrollTop = iframeDoc.documentElement?.scrollTop || iframeDoc.body?.scrollTop || 0;
          }
        } catch (e) {
          console.warn("Cannot access iframe scroll position (cross-origin):", e);
        }

        // Transform each rect accounting for iframe scaling
        for (const rect of rects) {
          // Apply scale factor to coordinates and dimensions
          const scaledWidth = rect.width * scaleX;
          const scaledHeight = rect.height * scaleY;
          const scaledTop = rect.top * scaleY;
          const scaledLeft = rect.left * scaleX;
          const scaledScrollTop = scrollTop * scaleY;
          const scaledScrollLeft = scrollLeft * scaleX;

          const transformedRect = {
            top: scaledTop + iframeRect.top + contentOffsetY - scaledScrollTop,
            left: scaledLeft + iframeRect.left + contentOffsetX - scaledScrollLeft,
            bottom: scaledTop + scaledHeight + iframeRect.top + contentOffsetY - scaledScrollTop,
            right: scaledLeft + scaledWidth + iframeRect.left + contentOffsetX - scaledScrollLeft,
            width: scaledWidth,
            height: scaledHeight,
            x: scaledLeft + iframeRect.left + contentOffsetX - scaledScrollLeft,
            y: scaledTop + iframeRect.top + contentOffsetY - scaledScrollTop
          };
          transformedRects.push(transformedRect);
        }

        rects = transformedRects;
      }

      // Generate a color based on the index
      const colors = [
        "#FF0000",
        "#00FF00",
        "#0000FF",
        "#FFA500",
        "#800080",
        "#008080",
        "#FF69B4",
        "#4B0082",
        "#FF4500",
        "#2E8B57",
        "#DC143C",
        "#4682B4",
      ];
      const colorIndex = index % colors.length;
      const baseColor = colors[colorIndex];
      const backgroundColor = baseColor + "1A"; // 10% opacity version of the color

      // No need for iframe offset calculation since rects are already transformed to main document coordinates
      const iframeOffset = { x: 0, y: 0 };

      // Create fragment to hold overlay elements
      const fragment = document.createDocumentFragment();

      // Create highlight overlays for each client rect
      for (const rect of rects) {
        if (rect.width === 0 || rect.height === 0) continue; // Skip empty rects

        const overlay = document.createElement("div");
        overlay.style.position = "fixed";
        overlay.style.border = `1px solid ${baseColor}`;
        overlay.style.backgroundColor = "none";
        overlay.style.pointerEvents = "none";
        overlay.style.boxSizing = "border-box";

        const top = rect.top + iframeOffset.y;
        const left = rect.left + iframeOffset.x;

        overlay.style.top = `${top}px`;
        overlay.style.left = `${left}px`;
        overlay.style.width = `${rect.width}px`;
        overlay.style.height = `${rect.height}px`;

        fragment.appendChild(overlay);
        overlays.push({ element: overlay, initialRect: rect }); // Store overlay and its rect
      }

      // Create and position a single label relative to the first rect
      const firstRect = rects[0];
      label = document.createElement("div");
      label.className = "playwright-highlight-label";
      label.style.position = "fixed";
      label.style.background = baseColor;
      label.style.color = "white";
      label.style.padding = "1px 4px";
      label.style.borderRadius = "4px";
      const fontSize = Math.min(index >= 100 ? 8 : 12, Math.max(8, firstRect.height / 2));
      label.style.fontSize = `${fontSize}px`;
      label.textContent = index;

      // labelWidth = label.offsetWidth > 0 ? label.offsetWidth : labelWidth; // Update actual width if possible
      // labelHeight = label.offsetHeight > 0 ? label.offsetHeight : labelHeight; // Update actual height if possible
      labelWidth *= fontSize / 12;
      labelHeight *= fontSize / 12;
      const digits = index.toString().length;
      labelWidth += (digits - 2) * fontSize / 1.5;
      labelHeight *= fontSize / 12;

      const firstRectTop = firstRect.top + iframeOffset.y;
      const firstRectLeft = firstRect.left + iframeOffset.x;

      let labelTop = firstRectTop - labelHeight - 4 * 12 / fontSize;
      let labelLeft = firstRectLeft + firstRect.width - labelWidth - 2;

      // Adjust label position if first rect is too small
      if (firstRect.width < labelWidth + 4 || firstRect.height < labelHeight + 4) {
        labelTop = firstRectTop - labelHeight;
        labelLeft = firstRectLeft + firstRect.width - labelWidth; // Align with right edge
        if (labelLeft < iframeOffset.x) labelLeft = firstRectLeft; // Prevent going off-left
      }

      // // Check if the label is too close to any existing label
      // const minDistance = 2; // Minimum distance between labels
      // let hasOverlap = true;
      // let attempts = 0;
      // const maxAttempts = 5;

      // const alignmentPositions = [
      //   // align with right edge (current default)
      //   firstRectLeft + firstRect.width - labelWidth - 2,
      //   // 1/4 of the way from the right edge
      //   firstRectLeft + (firstRect.width - labelWidth) / 2 + firstRect.width / 4,
      //   // in middle
      //   firstRectLeft + (firstRect.width - labelWidth) / 2,
      //   firstRectLeft + (firstRect.width - labelWidth) / 2 - firstRect.width / 4,
      //   // align with left edge
      //   firstRectLeft,
      // ];

      // while (hasOverlap && attempts < maxAttempts) {
      //   hasOverlap = false;

      //   // Use the current alignment position
      //   labelLeft = alignmentPositions[attempts];

      //   // Current label bounding box
      //   const currentLabel = {
      //     xmin: labelLeft,
      //     ymin: labelTop,
      //     xmax: labelLeft + labelWidth,
      //     ymax: labelTop + labelHeight,
      //   };

      //   for (const existingLabel of existingLabelBoundingBoxes) {
      //     // Check if labels overlap or are too close (using minDistance buffer)
      //     if (!(currentLabel.xmax + minDistance < existingLabel.xmin ||
      //           currentLabel.xmin > existingLabel.xmax + minDistance ||
      //           currentLabel.ymax + minDistance < existingLabel.ymin ||
      //           currentLabel.ymin > existingLabel.ymax + minDistance)) {
      //       hasOverlap = true;
      //       break;
      //     }
      //   }

      //   if (hasOverlap) {
      //     attempts++;
      //   }
      // }

      // Ensure label stays within viewport bounds slightly better
      labelTop = Math.max(0, Math.min(labelTop, window.innerHeight - labelHeight));
      labelLeft = Math.max(0, Math.min(labelLeft, window.innerWidth - labelWidth - 2));


      label.style.top = `${labelTop}px`;
      label.style.left = `${labelLeft}px`;

      // Add the label to the existing label bounding boxes
      existingLabelBoundingBoxes.push({
        xmin: labelLeft,
        ymin: labelTop,
        xmax: labelLeft + labelWidth,
        ymax: labelTop + labelHeight,
      });

      fragment.appendChild(label);

      // Update positions on scroll/resize
      const updatePositions = () => {
        let newRects = element.getClientRects(); // Get fresh rects

        // Transform rects if element is inside an iframe (same logic as initial highlighting)
        if (parentIframe) {
          const transformedRects = [];
          const iframeRect = parentIframe.getBoundingClientRect();

          // Get iframe's content area offset and CSS transforms
          const iframeStyle = window.getComputedStyle(parentIframe);
          const borderLeft = parseFloat(iframeStyle.borderLeftWidth) || 0;
          const borderTop = parseFloat(iframeStyle.borderTopWidth) || 0;
          const paddingLeft = parseFloat(iframeStyle.paddingLeft) || 0;
          const paddingTop = parseFloat(iframeStyle.paddingTop) || 0;

          const contentOffsetX = borderLeft + paddingLeft;
          const contentOffsetY = borderTop + paddingTop;

          // Extract scale factor from CSS transform
          let scaleX = 1, scaleY = 1;
          const transform = iframeStyle.transform;
          if (transform && transform !== 'none') {
            // Parse scale from transform matrix or scale() function
            const scaleMatch = transform.match(/scale\(([^)]+)\)/);
            if (scaleMatch) {
              const scaleValues = scaleMatch[1].split(',').map(v => parseFloat(v.trim()));
              scaleX = scaleValues[0] || 1;
              scaleY = scaleValues[1] || scaleX; // If only one value, use it for both X and Y
            } else {
              // Try to parse matrix() transform
              const matrixMatch = transform.match(/matrix\(([^)]+)\)/);
              if (matrixMatch) {
                const values = matrixMatch[1].split(',').map(v => parseFloat(v.trim()));
                if (values.length >= 6) {
                  scaleX = values[0]; // a value in matrix(a, b, c, d, e, f)
                  scaleY = values[3]; // d value in matrix(a, b, c, d, e, f)
                }
              }
            }
          }

          // Get iframe scroll position
          let scrollLeft = 0, scrollTop = 0;
          try {
            const iframeDoc = parentIframe.contentDocument || parentIframe.contentWindow?.document;
            if (iframeDoc) {
              scrollLeft = iframeDoc.documentElement?.scrollLeft || iframeDoc.body?.scrollLeft || 0;
              scrollTop = iframeDoc.documentElement?.scrollTop || iframeDoc.body?.scrollTop || 0;
            }
          } catch (e) {
            console.warn("Cannot access iframe scroll position (cross-origin):", e);
          }

          // Transform each rect accounting for iframe scaling
          for (const rect of newRects) {
            // Apply scale factor to coordinates and dimensions
            const scaledWidth = rect.width * scaleX;
            const scaledHeight = rect.height * scaleY;
            const scaledTop = rect.top * scaleY;
            const scaledLeft = rect.left * scaleX;
            const scaledScrollTop = scrollTop * scaleY;
            const scaledScrollLeft = scrollLeft * scaleX;

            const transformedRect = {
              top: scaledTop + iframeRect.top + contentOffsetY - scaledScrollTop,
              left: scaledLeft + iframeRect.left + contentOffsetX - scaledScrollLeft,
              bottom: scaledTop + scaledHeight + iframeRect.top + contentOffsetY - scaledScrollTop,
              right: scaledLeft + scaledWidth + iframeRect.left + contentOffsetX - scaledScrollLeft,
              width: scaledWidth,
              height: scaledHeight,
              x: scaledLeft + iframeRect.left + contentOffsetX - scaledScrollLeft,
              y: scaledTop + iframeRect.top + contentOffsetY - scaledScrollTop
            };
            transformedRects.push(transformedRect);
          }

          newRects = transformedRects;
        }

        const newIframeOffset = { x: 0, y: 0 }; // No offset needed since rects are already transformed

        // Update each overlay
        overlays.forEach((overlayData, i) => {
          if (i < newRects.length) { // Check if rect still exists
            const newRect = newRects[i];
            const newTop = newRect.top + newIframeOffset.y;
            const newLeft = newRect.left + newIframeOffset.x;

            overlayData.element.style.top = `${newTop}px`;
            overlayData.element.style.left = `${newLeft}px`;
            overlayData.element.style.width = `${newRect.width}px`;
            overlayData.element.style.height = `${newRect.height}px`;
            overlayData.element.style.display = (newRect.width === 0 || newRect.height === 0) ? 'none' : 'block';
          } else {
            // If fewer rects now, hide extra overlays
            overlayData.element.style.display = 'none';
          }
        });

        // If there are fewer new rects than overlays, hide the extras
        if (newRects.length < overlays.length) {
          for (let i = newRects.length; i < overlays.length; i++) {
            overlays[i].element.style.display = 'none';
          }
        }

        // Update label position based on the first new rect
        if (label && newRects.length > 0) {
          const firstNewRect = newRects[0];
          const firstNewRectTop = firstNewRect.top + newIframeOffset.y;
          const firstNewRectLeft = firstNewRect.left + newIframeOffset.x;

          let newLabelTop = firstNewRectTop + 2;
          let newLabelLeft = firstNewRectLeft + firstNewRect.width - labelWidth - 2;

          if (firstNewRect.width < labelWidth + 4 || firstNewRect.height < labelHeight + 4) {
            newLabelTop = firstNewRectTop - labelHeight - 2;
            newLabelLeft = firstNewRectLeft + firstNewRect.width - labelWidth;
            if (newLabelLeft < newIframeOffset.x) newLabelLeft = firstNewRectLeft;
          }

          // Ensure label stays within viewport bounds
          newLabelTop = Math.max(0, Math.min(newLabelTop, window.innerHeight - labelHeight));
          newLabelLeft = Math.max(0, Math.min(newLabelLeft, window.innerWidth - labelWidth));

          label.style.top = `${newLabelTop}px`;
          label.style.left = `${newLabelLeft}px`;
          label.style.display = 'block';
        } else if (label) {
          // Hide label if element has no rects anymore
          label.style.display = 'none';
        }
      };

      const throttleFunction = (func, delay) => {
        let lastCall = 0;
        return (...args) => {
          const now = performance.now();
          if (now - lastCall < delay) return;
          lastCall = now;
          return func(...args);
        };
      };

      // const throttledUpdatePositions = throttleFunction(updatePositions, 16); // ~60fps
      // window.addEventListener('scroll', throttledUpdatePositions, true);
      // window.addEventListener('resize', throttledUpdatePositions);

      // Add cleanup function
      cleanupFn = () => {
        // window.removeEventListener('scroll', throttledUpdatePositions, true);
        // window.removeEventListener('resize', throttledUpdatePositions);
        // Remove overlay elements if needed
        overlays.forEach(overlay => overlay.element.remove());
        if (label) label.remove();
      };

      // Then add fragment to container in one operation
      container.appendChild(fragment);

      return index + 1;
    } finally {
      // Store cleanup function for later use
      if (cleanupFn) {
        // Keep a reference to cleanup functions in a global array
        (window._highlightCleanupFunctions = window._highlightCleanupFunctions || []).push(cleanupFn);
      }
    }
  }


  /**
   * Gets the position of an element in its parent.
   *
   * @param {HTMLElement} currentElement - The element to get the position for.
   * @returns {number} The position of the element in its parent.
   */
  function getElementPosition(currentElement) {
    if (!currentElement.parentElement) {
      return 0; // No parent means no siblings
    }

    const tagName = currentElement.nodeName.toLowerCase();

    const siblings = Array.from(currentElement.parentElement.children)
      .filter((sib) => sib.nodeName.toLowerCase() === tagName);

    if (siblings.length === 1) {
      return 0; // Only element of its type
    }

    const index = siblings.indexOf(currentElement) + 1; // 1-based index
    return index;
  }


  function getXPathTree(element, stopAtBoundary = true) {
    if (xpathCache.has(element)) return xpathCache.get(element);

    const segments = [];
    let currentElement = element;

    while (currentElement && currentElement.nodeType === Node.ELEMENT_NODE) {
      // Stop if we hit a shadow root or iframe
      if (
        stopAtBoundary &&
        (currentElement.parentNode instanceof ShadowRoot ||
          currentElement.parentNode instanceof HTMLIFrameElement)
      ) {
        break;
      }

      const position = getElementPosition(currentElement);
      const tagName = currentElement.nodeName.toLowerCase();
      const xpathIndex = position > 0 ? `[${position}]` : "";
      segments.unshift(`${tagName}${xpathIndex}`);

      currentElement = currentElement.parentNode;
    }

    const result = segments.join("/");
    xpathCache.set(element, result);
    return result;
  }

  /**
   * Checks if a text node is visible.
   *
   * @param {Text} textNode - The text node to check.
   * @returns {boolean} Whether the text node is visible.
   */
  function isTextNodeVisible(textNode) {
    try {
      // Special case: when viewportExpansion is -1, consider all text nodes as visible
      if (viewportExpansion === -1) {
        // Still check parent visibility for basic filtering
        const parentElement = textNode.parentElement;
        if (!parentElement) return false;

        try {
          return parentElement.checkVisibility({
            checkOpacity: true,
            checkVisibilityCSS: true,
          });
        } catch (e) {
          // Fallback if checkVisibility is not supported
          const style = window.getComputedStyle(parentElement);
          return style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0';
        }
      }

      const range = document.createRange();
      range.selectNodeContents(textNode);
      const rects = range.getClientRects(); // Use getClientRects for Range

      if (!rects || rects.length === 0) {
        return false;
      }

      let isAnyRectVisible = false;
      let isAnyRectInViewport = false;

      for (const rect of rects) {
        // Check size
        if (rect.width > 0 && rect.height > 0) {
          isAnyRectVisible = true;

          // Viewport check for this rect
          if (!(
            rect.bottom < -viewportExpansion ||
            rect.top > window.innerHeight + viewportExpansion ||
            rect.right < -viewportExpansion ||
            rect.left > window.innerWidth + viewportExpansion
          )) {
            isAnyRectInViewport = true;
            break; // Found a visible rect in viewport, no need to check others
          }
        }
      }

      if (!isAnyRectVisible || !isAnyRectInViewport) {
        return false;
      }

      // Check parent visibility
      const parentElement = textNode.parentElement;
      if (!parentElement) return false;

      try {
        return parentElement.checkVisibility({
          checkOpacity: true,
          checkVisibilityCSS: true,
        });
      } catch (e) {
        // Fallback if checkVisibility is not supported
        const style = window.getComputedStyle(parentElement);
        return style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0';
      }
    } catch (e) {
      console.warn('Error checking text node visibility:', e);
      return false;
    }
  }

  /**
   * Checks if an element is accepted.
   *
   * @param {HTMLElement} element - The element to check.
   * @returns {boolean} Whether the element is accepted.
   */
  function isElementAccepted(element) {
    if (!element || !element.tagName) return false;

    // Always accept body and common container elements
    const alwaysAccept = new Set([
      "body", "html", "div", "main", "article", "section", "nav", "header", "footer"
    ]);
    const tagName = element.tagName.toLowerCase();

    if (alwaysAccept.has(tagName)) return true;

    const leafElementDenyList = new Set([
      "svg",
      "script",
      "style",
      "link",
      "meta",
      "noscript",
      "template",
    ]);

    return !leafElementDenyList.has(tagName);
  }

  /**
   * Checks if an element is visible.
   *
   * @param {HTMLElement} element - The element to check.
   * @returns {boolean} Whether the element is visible.
   */
  function isElementVisible(element) {
    if (element.tagName.toLowerCase() === "input" && element.type === "date") {
      return true;
    }

    if (alwaysHighlightFileInput && element.tagName.toLowerCase() === "input" && element.type === "file") return true;

    // SVG elements need special handling for visibility
    if (element.tagName.toLowerCase() === "svg") {
      const rect = getCachedBoundingRect(element);
      const style = getCachedComputedStyle(element);
      return (
        rect &&
        rect.width > 0 &&
        rect.height > 0 &&
        style?.visibility !== "hidden" &&
        style?.display !== "none"
      );
    }

    const style = getCachedComputedStyle(element);
    return (
      element.offsetWidth > 0 &&
      element.offsetHeight > 0 &&
      style?.visibility !== "hidden" &&
      style?.display !== "none"
    );
  }

  /**
   * Checks if an element is clickable (responds to click events).
   *
   * @param {HTMLElement} element - The element to check.
   * @returns {boolean} Whether the element is clickable.
   */
  function shouldMarkAsClickable(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    const tagName = element.tagName.toLowerCase();

    // Primarily clickable elements
    const primaryClickableElements = new Set([
      "a",          // Links
      "button",     // Buttons
      "details",    // Expandable details
      "summary",    // Summary element (clickable part of details)
      "label",      // Form labels (often clickable)
      "option",     // Select options
      "optgroup",   // Option groups
    ]);

    if (primaryClickableElements.has(tagName)) {
      return false;
    }

    const role = element.getAttribute("role");

    // Clickable roles
    const clickableRoles = new Set([
      'button',           // Directly clickable element
      'link',            // Clickable link
      'menuitem',        // Clickable menu item
      'menuitemradio',   // Radio-style menu item (selectable)
      'menuitemcheckbox', // Checkbox-style menu item (toggleable)
      'radio',           // Radio button (selectable)
      'checkbox',        // Checkbox (toggleable)
      'tab',             // Tab (clickable to switch content)
      'switch',          // Toggle switch (clickable to change state)
      'option',          // Selectable option in a list
    ]);

    if (role && clickableRoles.has(role)) {
      return true;
    }

    // Check for dropdown indicators
    if (hasAnyClassName(element, buttonClassNames)) {
      return true; // Return true for dropdown elements
    }

    if (
      element.getAttribute('data-toggle') === 'dropdown' ||
      element.getAttribute('aria-haspopup')
    ) {
      return true;
    }

    const clickEvents = ['click', 'mousedown', 'mouseup', 'dblclick'];
    const listenedEvents = getCachedNodeEventListeners(element);
    if (listenedEvents && listenedEvents.length > 0) {
      for (const eventType of clickEvents) {
        if (listenedEvents.includes(eventType)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Checks if an element is interactive.
   *
   * lots of comments, and uncommented code - to show the logic of what we already tried
   *
   * One of the things we tried at the beginning was also to use event listeners, and other fancy class, style stuff -> what actually worked best was just combining most things with computed cursor style :)
   *
   * @param {HTMLElement} element - The element to check.
   */
  function isInteractiveElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    // Cache the tagName and style lookups
    const tagName = element.tagName.toLowerCase();
    const style = getCachedComputedStyle(element);

    // Define interactive cursors
    const interactiveCursors = new Set([
      'pointer',    // Link/clickable elements
      'move',       // Movable elements
      'text',       // Text selection
      'grab',       // Grabbable elements
      'grabbing',   // Currently grabbing
      'cell',       // Table cell selection
      'copy',       // Copy operation
      'alias',      // Alias creation
      'all-scroll', // Scrollable content
      'col-resize', // Column resize
      'context-menu', // Context menu available
      'crosshair',  // Precise selection
      'e-resize',   // East resize
      'ew-resize',  // East-west resize
      'help',       // Help available
      'n-resize',   // North resize
      'ne-resize',  // Northeast resize
      'nesw-resize', // Northeast-southwest resize
      'ns-resize',  // North-south resize
      'nw-resize',  // Northwest resize
      'nwse-resize', // Northwest-southeast resize
      'row-resize', // Row resize
      's-resize',   // South resize
      'se-resize',  // Southeast resize
      'sw-resize',  // Southwest resize
      'vertical-text', // Vertical text selection
      'w-resize',   // West resize
      'zoom-in',    // Zoom in
      'zoom-out'    // Zoom out
    ]);

    // Define non-interactive cursors
    const nonInteractiveCursors = new Set([
      'not-allowed', // Action not allowed
      'no-drop',     // Drop not allowed
      'wait',        // Processing
      'progress',    // In progress
      'initial',     // Initial value
      'inherit'      // Inherited value
      //? Let's just include all potentially clickable elements that are not specifically blocked
      // 'none',        // No cursor
      // 'default',     // Default cursor
      // 'auto',        // Browser default
    ]);

    /**
     * Checks if an element has an interactive pointer.
     *
     * @param {HTMLElement} element - The element to check.
     * @returns {boolean} Whether the element has an interactive pointer.
     */
    function doesElementHaveInteractivePointer(element) {
      if (element.tagName.toLowerCase() === "html") return false;

      if (style?.cursor && interactiveCursors.has(style.cursor)) return true;

      return false;
    }
    // Disabled for now, since it adds too many false positives
    // let isInteractiveCursor = doesElementHaveInteractivePointer(element);

    // // Genius fix for almost all interactive elements
    // if (isInteractiveCursor) {
    //   return true;
    // }

    const interactiveElements = new Set([
      "a",          // Links
      "button",     // Buttons
      "input",      // All input types (text, checkbox, radio, etc.)
      "select",     // Dropdown menus
      "textarea",   // Text areas
      "details",    // Expandable details
      "summary",    // Summary element (clickable part of details)
      "label",      // Form labels (often clickable)
      "option",     // Select options
      "optgroup",   // Option groups
      "fieldset",   // Form fieldsets (can be interactive with legend)
      "legend",     // Fieldset legends
    ]);

    // Define explicit disable attributes and properties
    const explicitDisableTags = new Set([
      'disabled',           // Standard disabled attribute
      // 'aria-disabled',      // ARIA disabled state
      // 'readonly',          // Read-only state
      // 'aria-readonly',     // ARIA read-only state
      // 'aria-hidden',       // Hidden from accessibility
      // 'hidden',            // Hidden attribute
      // 'inert',             // Inert attribute
      // 'aria-inert',        // ARIA inert state
      // 'tabindex="-1"',     // Removed from tab order
      // 'aria-hidden="true"' // Hidden from screen readers
    ]);

    // Check for non-interactive cursor
    if (style?.cursor && nonInteractiveCursors.has(style.cursor)) {
      return false;
    }

    // handle inputs, select, checkbox, radio, textarea, button and make sure they are not cursor style disabled/not-allowed
    if (interactiveElements.has(tagName)) {
      // Check for explicit disable attributes
      for (const disableTag of explicitDisableTags) {
        if (element.hasAttribute(disableTag) ||
          element.getAttribute(disableTag) === 'true' ||
          element.getAttribute(disableTag) === '') {
          return false;
        }
      }

      // Check for disabled property on form elements
      if (element.disabled) {
        return false;
      }

      // Don't mark as non-interactive yet
      // Check for readonly property on form elements
      if (element.readOnly) {
        // return false;
      }

      // Check for inert property
      if (element.inert) {
        return false;
      }

      return true;
    }

    const role = element.getAttribute("role");
    const ariaRole = element.getAttribute("aria-role");

    // Check for contenteditable attribute
    if (element.getAttribute("contenteditable") === "true" || element.isContentEditable) {
      return true;
    }

    // Added enhancement to capture dropdown interactive elements
    if (hasAnyClassName(element, buttonClassNames) ||
        hasAnyClassName(element, interactiveClassNames) ||
      element.getAttribute('data-index') ||
      element.getAttribute('data-toggle') === 'dropdown' ||
        element.getAttribute('aria-haspopup')) {
      return true;
    }


    const interactiveRoles = new Set([
      'button',           // Directly clickable element
      'link',            // Clickable link
      'menuitem',        // Clickable menu item
      'menuitemradio',   // Radio-style menu item (selectable)
      'menuitemcheckbox', // Checkbox-style menu item (toggleable)
      'radio',           // Radio button (selectable)
      'checkbox',        // Checkbox (toggleable)
      'tab',             // Tab (clickable to switch content)
      'switch',          // Toggle switch (clickable to change state)
      'slider',          // Slider control (draggable)
      'spinbutton',      // Number input with up/down controls
      'combobox',        // Dropdown with text input
      'searchbox',       // Search input field
      'textbox',         // Text input field
      'listbox',         // Selectable list
      'option',          // Selectable option in a list
      'scrollbar'        // Scrollable control
    ]);


    // Basic role/attribute checks
    const hasInteractiveRole =
      (role && interactiveRoles.has(role)) ||
      (ariaRole && interactiveRoles.has(ariaRole));

    if (hasInteractiveRole) return true;

    const listenedEvents = getCachedNodeEventListeners(element);
    if (listenedEvents && listenedEvents.length > 0) {
      for (const eventType of INTERACTION_EVENTS) {
        if (listenedEvents.includes(eventType)) {
          return true;
        }
      }
    }

    return false
  }


  /**
   * Checks if an element is the topmost element at its position.
   *
   * @param {HTMLElement} element - The element to check.
   * @returns {boolean} Whether the element is the topmost element at its position.
   */
  function isTopElement(element) {
    if (element.tagName.toLowerCase() === "input" && element.type === "date") {
      return true;
    }
    // Special case: when viewportExpansion is -1, consider all elements as "top" elements
    if (viewportExpansion === -1) {
      return true;
    }

    const rects = getCachedClientRects(element); // Replace element.getClientRects()

    if (!rects || rects.length === 0) {
      return false; // No geometry, cannot be top
    }

    let isAnyRectInViewport = false;
    for (const rect of rects) {
      // Use the same logic as isInExpandedViewport check
      if (rect.width > 0 && rect.height > 0 && !( // Only check non-empty rects
        rect.bottom < -viewportExpansion ||
        rect.top > window.innerHeight + viewportExpansion ||
        rect.right < -viewportExpansion ||
        rect.left > window.innerWidth + viewportExpansion
      )) {
        isAnyRectInViewport = true;
        break;
      }
    }

    if (!isAnyRectInViewport) {
      return false; // All rects are outside the viewport area
    }


    // Find the correct document context and root element
    let doc = element.ownerDocument;

    // If we're in an iframe, elements are considered top by default
    if (doc !== window.document) {
      return true;
    }

    // For shadow DOM, we need to check within its own root context
    const shadowRoot = element.getRootNode();
    if (shadowRoot instanceof ShadowRoot) {
      const centerX = rects[Math.floor(rects.length / 2)].left + rects[Math.floor(rects.length / 2)].width / 2;
      const centerY = rects[Math.floor(rects.length / 2)].top + rects[Math.floor(rects.length / 2)].height / 2;

      try {
        const topEl = shadowRoot.elementFromPoint(centerX, centerY);
        if (!topEl) return false;

        let current = topEl;
        while (current && current !== shadowRoot) {
          if (current === element) return true;
          current = current.parentElement;
        }
        return false;
      } catch (e) {
        return true;
      }
    }

    // For elements in viewport, check if they're topmost
    const centerX = rects[Math.floor(rects.length / 2)].left + rects[Math.floor(rects.length / 2)].width / 2;
    const centerY = rects[Math.floor(rects.length / 2)].top + rects[Math.floor(rects.length / 2)].height / 2;

    try {
      const topEl = document.elementFromPoint(centerX, centerY);
      if (!topEl) return false;

      let current = topEl;
      while (current && current !== document.documentElement) {
        if (current === element) return true;
        current = current.parentElement;
      }
      return false;
    } catch (e) {
      return true;
    }
  }

  /**
   * Checks if an element is within the expanded viewport.
   *
   * @param {HTMLElement} element - The element to check.
   * @param {number} viewportExpansion - The viewport expansion.
   * @returns {boolean} Whether the element is within the expanded viewport.
   */
  function isInExpandedViewport(element, viewportExpansion) {
    if (viewportExpansion === -1) {
      return true;
    }

    const rects = element.getClientRects(); // Use getClientRects

    if (!rects || rects.length === 0) {
      // Fallback to getBoundingClientRect if getClientRects is empty,
      // useful for elements like <svg> that might not have client rects but have a bounding box.
      const boundingRect = getCachedBoundingRect(element);
      if (!boundingRect || boundingRect.width === 0 || boundingRect.height === 0) {
        return false;
      }
      return !(
        boundingRect.bottom < -viewportExpansion ||
        boundingRect.top > window.innerHeight + viewportExpansion ||
        boundingRect.right < -viewportExpansion ||
        boundingRect.left > window.innerWidth + viewportExpansion
      );
    }

    // Check if *any* client rect is within the viewport
    for (const rect of rects) {
      if (rect.width === 0 || rect.height === 0) continue; // Skip empty rects

      if (!(
        rect.bottom < -viewportExpansion ||
        rect.top > window.innerHeight + viewportExpansion ||
        rect.right < -viewportExpansion ||
        rect.left > window.innerWidth + viewportExpansion
      )) {
        return true; // Found at least one rect in the viewport
      }
    }

    return false; // No rects were found in the viewport
  }

  // /**
  //  * Gets the effective scroll of an element.
  //  *
  //  * @param {HTMLElement} element - The element to get the effective scroll for.
  //  * @returns {Object} The effective scroll of the element.
  //  */
  // function getEffectiveScroll(element) {
  //   let currentEl = element;
  //   let scrollX = 0;
  //   let scrollY = 0;

  //   while (currentEl && currentEl !== document.documentElement) {
  //     if (currentEl.scrollLeft || currentEl.scrollTop) {
  //       scrollX += currentEl.scrollLeft;
  //       scrollY += currentEl.scrollTop;
  //     }
  //     currentEl = currentEl.parentElement;
  //   }

  //   scrollX += window.scrollX;
  //   scrollY += window.scrollY;

  //   return { scrollX, scrollY };
  // }

  /**
   * Checks if an element is an interactive candidate.
   *
   * @param {HTMLElement} element - The element to check.
   * @returns {boolean} Whether the element is an interactive candidate.
   */
  function isInteractiveCandidate(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;

    const tagName = element.tagName.toLowerCase();

    // Fast-path for common interactive elements
    const interactiveElements = new Set([
      "a", "button", "input", "select", "textarea", "details", "summary", "label"
    ]);

    if (interactiveElements.has(tagName)) return true;

    // Quick attribute checks without getting full lists
    const hasQuickInteractiveAttr = element.hasAttribute("onclick") ||
      element.hasAttribute("role") ||
      element.hasAttribute("tabindex") ||
      element.hasAttribute("aria-") ||
      element.hasAttribute("data-action") ||
      element.getAttribute("contenteditable") === "true";

    return hasQuickInteractiveAttr;
  }

  // --- Define constants for distinct interaction check ---
  const DISTINCT_INTERACTIVE_TAGS = new Set([
    'a', 'button', 'input', 'select', 'textarea', 'summary', 'details', 'label', 'option'
  ]);
  const INTERACTIVE_ROLES = new Set([
    'button', 'link', 'menuitem', 'menuitemradio', 'menuitemcheckbox',
    'radio', 'checkbox', 'tab', 'switch', 'slider', 'spinbutton',
    'combobox', 'searchbox', 'textbox', 'listbox', 'option', 'scrollbar'
  ]);


  /**
   * Heuristically determines if an element should be considered as independently interactive,
   * even if it's nested inside another interactive container.
   *
   * This function helps detect deeply nested actionable elements (e.g., menu items within a button)
   * that may not be picked up by strict interactivity checks.
   *
   * @param {HTMLElement} element - The element to check.
   * @returns {boolean} Whether the element is heuristically interactive.
   */
  function isHeuristicallyInteractive(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;

    // Skip non-visible elements early for performance
    if (!isElementVisible(element)) return false;

    // Check for common attributes that often indicate interactivity
    const hasInteractiveAttributes =
      element.hasAttribute('role') ||
      element.hasAttribute('tabindex') ||
      element.hasAttribute('onclick') ||
      typeof element.onclick === 'function';

    // Check for semantic class names suggesting interactivity
    const hasInteractiveClass = heuristicClassPattern.test(element.className || '');

    // Determine whether the element is inside a known interactive container
    const isInKnownContainer = Boolean(
      element.closest(containerSelectors)
    );

    // Ensure the element has at least one visible child (to avoid marking empty wrappers)
    const hasVisibleChildren = [...element.children].some(isElementVisible);

    // Avoid highlighting elements whose parent is <body> (top-level wrappers)
    const isParentBody = element.parentElement && element.parentElement.isSameNode(document.body);

    return (
      (isInteractiveElement(element) || hasInteractiveAttributes || hasInteractiveClass) &&
      hasVisibleChildren &&
      isInKnownContainer &&
      !isParentBody
    );
  }


  /**
   * Checks if an element likely represents a distinct interaction
   * separate from its parent (if the parent is also interactive).
   *
   * @param {HTMLElement} element - The element to check.
   * @param {Object} nodeData - The node data object.
   * @returns {boolean} Whether the element is a distinct interaction.
   */
  function isElementDistinctInteraction(element, nodeData) {
    if (nodeData.isScrollable) {
      return true;
    }

    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    const tagName = element.tagName.toLowerCase();
    const role = element.getAttribute('role');

    // Check if it's an iframe - always distinct boundary
    if (tagName === 'iframe') {
      return true;
    }

    // Check tag name
    if (DISTINCT_INTERACTIVE_TAGS.has(tagName)) {
      return true;
    }
    // Check interactive roles
    if (role && INTERACTIVE_ROLES.has(role)) {
      return true;
    }
    // Check contenteditable
    if (element.isContentEditable || element.getAttribute('contenteditable') === 'true') {
      return true;
    }
    // Check for common testing/automation attributes
    if (element.hasAttribute('data-testid') || element.hasAttribute('data-cy') || element.hasAttribute('data-test')) {
      return true;
    }
    // Check for explicit onclick handler (attribute or property)
    if (element.hasAttribute('onclick') || typeof element.onclick === 'function') {
      return true;
    }

    if (element.hasAttribute('aria-haspopup')) {
      return true;
    }

    if (hasAnyClassName(element, interactiveClassNames)) {
      return true;
    }

    // return false

    // Check for other common interaction event listeners
    try {
      const getEventListenersForNode = element?.ownerDocument?.defaultView?.getEventListenersForNode || window.getEventListenersForNode;
      if (typeof getEventListenersForNode === 'function') {
        const listeners = getEventListenersForNode(element);
        const interactionEvents = ['click', 'mousedown', 'mouseup', 'dblclick', 'input', 'mouseenter', 'mouseleave', 'keydown', 'keyup', 'submit', 'change', 'focus', 'blur'];
        for (const eventType of interactionEvents) {
          for (const listener of listeners) {
            if (listener.type === eventType) {
              return true; // Found a common interaction listener
            }
          }
        }
      }
      // Fallback: Check common event attributes if getEventListeners is not available (getEventListenersForNode doesn't work in page.evaluate context)
      const commonEventAttrs = ['onmousedown', 'onmouseup', 'onkeydown', 'onkeyup', 'onsubmit', 'onmouseenter', 'onmouseleave', 'onchange', 'oninput', 'onfocus', 'onblur'];
      if (commonEventAttrs.some(attr => element.hasAttribute(attr))) {
        return true;
      }
    } catch (e) {
      // console.warn(`Could not check event listeners for ${element.tagName}:`, e);
      // If checking listeners fails, rely on other checks
    }



    // if the element is not strictly interactive but appears clickable based on heuristic signals
    if (isHeuristicallyInteractive(element)) {
      return true;
    }

    // Default to false: if it's interactive but doesn't match above,
    // assume it triggers the same action as the parent.
    return false;
  }
  // --- End distinct interaction check ---

  /**
   * Handles the logic for deciding whether to highlight an element and performing the highlight.
   * @param {
    {
        tagName: string;
        attributes: Record<string, string>;
        xpath: any;
        children: never[];
        isVisible?: boolean;
        isTopElement?: boolean;
        isInteractive?: boolean;
        isInViewport?: boolean;
        highlightIndex?: number;
        shadowRoot?: boolean;
   }} nodeData - The node data object.
   * @param {HTMLElement} node - The node to highlight.
   * @param {HTMLElement | null} parentIframe - The parent iframe node.
   * @param {boolean} isParentHighlighted - Whether the parent node is highlighted.
   * @returns {boolean} Whether the element was highlighted.
   */
  function handleHighlighting(nodeData, node, parentIframe, isParentHighlighted) {
    if (!nodeData.isInteractive) return false; // Not interactive, definitely don't highlight

    let shouldHighlight = false;
    if (!isParentHighlighted) {
      // Parent wasn't highlighted, this interactive node can be highlighted.
      shouldHighlight = true;
    } else {
      // Parent *was* highlighted. Only highlight this node if it represents a distinct interaction.
      if (isElementDistinctInteraction(node, nodeData)) {
        shouldHighlight = true;
      } else {
        // console.log(`Skipping highlight for ${nodeData.tagName} (parent highlighted)`);
        shouldHighlight = false;
      }
    }

    if (shouldHighlight) {
      const attributeNames = node.getAttributeNames?.() || [];
      for (const name of attributeNames) {
        const value = node.getAttribute(name);
        nodeData.attributes[name] = value;
      }

      // Check viewport status before assigning index and highlighting
      if (nodeData.isInViewport === undefined) {
        nodeData.isInViewport = isInExpandedViewport(node, viewportExpansion);
      }

      // When viewportExpansion is -1, all interactive elements should get a highlight index
      // regardless of viewport status
      if (nodeData.isInViewport || viewportExpansion === -1) {
        nodeData.highlightIndex = highlightIndex++;

        if (doHighlightElements) {
          if (focusHighlightIndex >= 0) {
            if (focusHighlightIndex === nodeData.highlightIndex) {
              highlightElement(node, nodeData.highlightIndex, parentIframe);
            }
          } else {
            highlightElement(node, nodeData.highlightIndex, parentIframe);
          }
          return true; // Successfully highlighted
        }
      } else {
        // console.log(`Skipping highlight for ${nodeData.tagName} (outside viewport)`);
      }
    }

    return false; // Did not highlight
  }

  function isElementScrollable(element) {
    const listenedEvents = getCachedNodeEventListeners(element);
    if (listenedEvents && listenedEvents.includes('scroll')) {
      const hasScrollableX = element.scrollWidth > element.clientWidth;
      const hasScrollableY = element.scrollHeight > element.clientHeight;
      return hasScrollableX || hasScrollableY;
    }

    const style = getCachedComputedStyle(element);
    const hasScrollableX = ['auto', 'scroll'].includes(style.overflowX) &&
        element.scrollWidth > element.clientWidth;
    const hasScrollableY = ['auto', 'scroll'].includes(style.overflowY) &&
        element.scrollHeight > element.clientHeight;
    return hasScrollableX || hasScrollableY;
  }

  function addSemanticAttributesToNodeData(node, nodeData) {
    for (const attr of SEMANTIC_ATTRIBUTES) {
      if (node.hasAttribute(attr)) {
        nodeData.attributes[attr] = node.getAttribute(attr);
      }
    }
  }

  /**
   * Creates a node data object for a given node and its descendants.
   *
   * @param {HTMLElement} node - The node to process.
   * @param {HTMLElement | null} parentIframe - The parent iframe node.
   * @param {boolean} isParentHighlighted - Whether the parent node is highlighted.
   * @returns {string | null} The ID of the node data object, or null if the node is not processed.
   */
  function buildDomTree(node, parentIframe = null, isParentHighlighted = false, shadowHostXPaths = []) {

    // Fast rejection checks first
    if (!node || node.id === HIGHLIGHT_CONTAINER_ID) {
      return null;
    }

    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.TEXT_NODE) {
      return null;
    }

    // Special handling for root node (body)
    if (node === document.body) {
      const nodeData = {
        tagName: 'body',
        attributes: {},
        xpath: '/body',
        children: [],
        shadowHostXPaths: [],
      };

      // Process children of body
      for (const child of node.childNodes) {
        const domElement = buildDomTree(child, parentIframe, false, shadowHostXPaths); // Body's children have no highlighted parent initially
        if (domElement) nodeData.children.push(domElement);
      }

      const id = `${ID.current++}`;
      DOM_HASH_MAP[id] = nodeData;
      return id;
    }

    // Process text nodes
    if (node.nodeType === Node.TEXT_NODE) {
      const textContent = node.textContent?.trim();
      if (!textContent) {
        return null;
      }

      // Only check visibility for text nodes that might be visible
      const parentElement = node.parentElement;
      if (!parentElement || parentElement.tagName.toLowerCase() === 'script') {
        return null;
      }

      const id = `${ID.current++}`;
      DOM_HASH_MAP[id] = {
        type: "TEXT_NODE",
        text: textContent,
        isVisible: isTextNodeVisible(node),
      };
      return id;
    }

    // Quick checks for element nodes
    if (node.nodeType === Node.ELEMENT_NODE && !isElementAccepted(node)) {
      return null;
    }

    /**
     * @type {
      {
          tagName: string;
          attributes: Record<string, string | null>;
          xpath: any;
          children: never[];
          isVisible?: boolean;
          isTopElement?: boolean;
          isInteractive?: boolean;
          isInViewport?: boolean;
          highlightIndex?: number;
          shadowRoot?: boolean;
      }
    } nodeData - The node data object.
     */
    const nodeData = {
      tagName: node.tagName.toLowerCase(),
      attributes: {},
      xpath: getXPathTree(node, true),
      children: [],
      shadowHostXPaths,
    };

    // Get attributes for interactive elements or potential text containers
    if (node.tagName.toLowerCase() === 'iframe' || node.tagName.toLowerCase() === 'body') {
      const attributeNames = node.getAttributeNames?.() || [];
      for (const name of attributeNames) {
        const value = node.getAttribute(name);
        nodeData.attributes[name] = value;
      }
    }

    let nodeWasHighlighted = false;
    // Perform visibility, interactivity, and highlighting checks
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (alwaysHighlightFileInput && node.tagName.toLowerCase() === 'input' && node.type === 'file') {
        nodeData.isTopElement = true;
        if (nodeData.isTopElement) {
          nodeData.isInteractive = true;
          nodeData.isInViewport = true; // File inputs should always be considered in viewport
          // Call the dedicated highlighting function
          nodeWasHighlighted = handleHighlighting(nodeData, node, parentIframe, isParentHighlighted);
        }
      } else {
        nodeData.isVisible = isElementVisible(node); // isElementVisible uses offsetWidth/Height, which is fine

        if (nodeData.isVisible) {
          nodeData.isTopElement = isTopElement(node);
          if (nodeData.isTopElement) {
            addSemanticAttributesToNodeData(node, nodeData);
            let isScrollable = isElementScrollable(node);
            nodeData.isInteractive = isInteractiveElement(node) || isScrollable;
            nodeData.isScrollable = isScrollable;
            nodeData.markAsClickable = shouldMarkAsClickable(node);
            // Call the dedicated highlighting function
            nodeWasHighlighted = handleHighlighting(nodeData, node, parentIframe, isParentHighlighted);
          }
        }
      }
    }

    // Process children, with special handling for iframes and rich text editors
    if (node.tagName) {
      const tagName = node.tagName.toLowerCase();

      // Handle iframes
      if (tagName === "iframe") {
        try {
          const iframeDoc = node.contentDocument || node.contentWindow?.document;
          if (iframeDoc) {
            for (const child of iframeDoc.childNodes) {
              const domElement = buildDomTree(child, node, false, shadowHostXPaths);
              if (domElement) nodeData.children.push(domElement);
            }
          }
        } catch (e) {
          console.warn("Unable to access iframe:", e);
          nodeData.inaccessibleFrame = true;
        }
      }
      // Handle rich text editors and contenteditable elements
      else if (
        node.isContentEditable ||
        node.getAttribute("contenteditable") === "true" ||
        node.id === "tinymce" ||
        node.classList.contains("mce-content-body") ||
        (tagName === "body" && node.getAttribute("data-id")?.startsWith("mce_"))
      ) {
        // Process all child nodes to capture formatted text
        for (const child of node.childNodes) {
          const domElement = buildDomTree(child, parentIframe, nodeWasHighlighted, shadowHostXPaths);
          if (domElement) nodeData.children.push(domElement);
        }
      }
      else {
        // Handle shadow DOM
        if (node.shadowRoot) {
          nodeData.shadowRoot = true;
          const childShadowHostXPaths = [...shadowHostXPaths, nodeData.xpath];
          for (const child of node.shadowRoot.childNodes) {
            const domElement = buildDomTree(child, parentIframe, nodeWasHighlighted, childShadowHostXPaths);
            if (domElement) nodeData.children.push(domElement);
          }
        }
        // Handle regular elements
        for (const child of node.childNodes) {
          // Pass the highlighted status of the *current* node to its children
          const passHighlightStatusToChild = nodeWasHighlighted || isParentHighlighted;
          const domElement = buildDomTree(child, parentIframe, passHighlightStatusToChild, shadowHostXPaths);
          if (domElement) nodeData.children.push(domElement);
        }
      }
    }

    const id = `${ID.current++}`;
    DOM_HASH_MAP[id] = nodeData;
    return id;
  }

  const normalizedDomTreeRoot = domTreeRoot === "document" ? "document" : "body";
  const rootNode = normalizedDomTreeRoot === "document"
    ? (document.documentElement || document.body)
    : (document.body || document.documentElement);

  const rootId = buildDomTree(rootNode);

  // Clear the cache before starting
  DOM_CACHE.clearCache();

  return { rootId, map: DOM_HASH_MAP };
}
