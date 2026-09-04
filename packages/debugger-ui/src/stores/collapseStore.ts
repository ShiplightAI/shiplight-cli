import { create } from 'zustand';

interface CollapseState {
  collapsedStates: Record<string, boolean>;
  isCollapsed: (id: string) => boolean;
  setCollapsed: (id: string, collapsed: boolean) => void;
  toggleCollapsed: (id: string) => void;
  ensureInitialized: (id: string, defaultCollapsed?: boolean) => boolean;
}

export const useCollapseStore = create<CollapseState>((set, get) => ({
  collapsedStates: {},
  
  isCollapsed: (id: string) => {
    const state = get();
    return state.collapsedStates[id] ?? true;
  },
  
  setCollapsed: (id: string, collapsed: boolean) => 
    set((state) => ({
      collapsedStates: {
        ...state.collapsedStates,
        [id]: collapsed
      }
    })),
  
  toggleCollapsed: (id: string) => {
    const currentState = get().isCollapsed(id);
    get().setCollapsed(id, !currentState);
  },
  
  ensureInitialized: (id: string, defaultCollapsed: boolean = true) => {
    const state = get();
    if (!(id in state.collapsedStates)) {
      // Initialize with the provided default
      set((prevState) => ({
        collapsedStates: {
          ...prevState.collapsedStates,
          [id]: defaultCollapsed
        }
      }));
      return defaultCollapsed;
    }
    return state.collapsedStates[id];
  }
})); 