
import { useUserProfiles } from "@/hooks/useUserProfile";
import { UserAvatar } from "../core/UserAvatar";
import { useMemo } from "react";

interface UserAvatarProps {
  userId: string;
  size?: "xs" | "sm" | "md";
  className?: string;
  action?: string;
}

export const UserAvatarByUserId = ({ userId, size = "sm", className = "", action = "Run" }: UserAvatarProps) => {
  const userIds = useMemo(() => [userId], [userId]);
  const { userProfiles } = useUserProfiles(userIds);
  const userInfo = userProfiles[userId];
  if (!userInfo) return null;
  return (
    <UserAvatar userInfo={userInfo} size={size} className={className} action={action} />
  );
}