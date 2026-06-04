import { useAuthStore } from '../../store/authStore';

export const useRole = () => {
  const user = useAuthStore((state) => state.user);
  return user?.role || 'viewer';
};
