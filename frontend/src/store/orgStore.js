import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useOrgStore = create(
  persist(
    (set) => ({
      currentOrgId: null,
      setCurrentOrgId: (orgId) => set({ currentOrgId: orgId }),
      clearOrgId: () => set({ currentOrgId: null }),
    }),
    {
      name: 'org-storage',
    }
  )
);
