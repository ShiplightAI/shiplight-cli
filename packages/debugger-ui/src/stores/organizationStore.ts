// stores/organizationStore.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { OrganizationEntity } from "@/common/entities/organizationEntity";

interface OrganizationState {
  organization: OrganizationEntity | null;
  setOrganization: (org: OrganizationEntity) => void;
  clearOrganization: () => void;
}

const useOrganizationStore = create<OrganizationState>()(
  persist(
    (set) => ({
      organization: null,
      setOrganization: (org: OrganizationEntity) => set({ organization: org }),
      clearOrganization: () => set({ organization: null }),
    }),
    {
      name: "organization-storage",
    }
  )
);

export default useOrganizationStore;
