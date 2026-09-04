// Init script to match production browser setup
export const INIT_SCRIPT = `
// check to make sure we're not inside the PDF viewer
window.isPdfViewer = !!document?.body?.querySelector('body > embed[type="application/pdf"][width="100%"]')
if (!window.isPdfViewer) {
  window.showOpenFilePicker = async () => {
    const files = window.__pw_showOpenFilePicker_mock_files ?? [];
    console.log('showOpenFilePicker: ', files);
    return Promise.resolve(files.map(({ path, buffer }) => ({
      // You can add more FileSystemFileHandle fields as necessary
      getFile: () => Promise.resolve(new File([buffer], path))
    })));
  };
  (() => {
    if (window._eventListenerTrackerInitialized) return;
    window._eventListenerTrackerInitialized = true;

    const originalAddEventListener = EventTarget.prototype.addEventListener;
    const eventListenersMap = new WeakMap();

    EventTarget.prototype.addEventListener = function(type, listener, options) {
      if (typeof listener === "function") {
        let listeners = eventListenersMap.get(this);
        if (!listeners) {
          listeners = [];
          eventListenersMap.set(this, listeners);
        }

        listeners.push({
          type,
          listener,
          listenerPreview: listener.toString().slice(0, 100),
          options
        });
      }

      return originalAddEventListener.call(this, type, listener, options);
    };

    window.getEventListenersForNode = (node) => {
      const listeners = eventListenersMap.get(node) || [];
      return listeners.map(({ type, listenerPreview, options }) => ({
        type,
        listenerPreview,
        options
      }));
    };
  })();
}
`;
