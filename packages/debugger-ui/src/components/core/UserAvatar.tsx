import { Avatar, Tooltip } from "@mantine/core";
import { useTranslations } from "next-intl";

interface UserInfo {
  id: string;
  avatar?: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  isUnknownUser?: boolean;
}

interface UserAvatarProps {
  userInfo: UserInfo;
  size?: "xs" | "sm" | "md";
  className?: string;
  action?: string;
}

export function UserAvatar({ userInfo, size = "sm", className = "", action = "Run" }: UserAvatarProps) {
  const t = useTranslations("Core.userAvatar");

  // Handle the special case for unknown users
  if (userInfo.isUnknownUser) {
    return (
      <Tooltip label={t("runByUnknown", { action })} withArrow position="top">
        <Avatar
          radius="xl"
          size={size}
          className={`${className} !h-[1.5rem] !w-[1.5rem] !min-w-[1.5rem] text-lg font-extrabold text-white bg-gray-700`}
        >
          <span style={{ color: "#fff", fontWeight: 800, filter: "none" }}>?</span>
        </Avatar>
      </Tooltip>
    );
  }

  // Get display name (for tooltip)
  const displayName =
    userInfo.fullName ||
    (userInfo.firstName || userInfo.lastName
      ? `${userInfo.firstName || ""} ${userInfo.lastName || ""}`.trim()
      : t("unknownUser"));

  // Get avatar initials
  const getInitials = () => {
    // Prioritize fullName
    if (userInfo.fullName) {
      const names = userInfo.fullName.trim().split(/\s+/);
      if (names.length === 0) return "?";
      if (names.length === 1) return names[0].charAt(0).toUpperCase();
      return (names[0].charAt(0) + names[names.length - 1].charAt(0)).toUpperCase();
    }

    // Use firstName and lastName
    const first = userInfo.firstName?.charAt(0) || "";
    const last = userInfo.lastName?.charAt(0) || "";

    if (first || last) {
      return (first + last).toUpperCase();
    }

    return "?";
  };

  // Vibrant 700-level color palette for backgrounds
  const bgColors = [
    "bg-blue-700",
    "bg-indigo-700",
    "bg-rose-700",
    "bg-green-700",
    "bg-teal-700",
    "bg-purple-700",
    "bg-pink-700",
    "bg-orange-700",
    "bg-red-700",
    "bg-cyan-700",
    "bg-violet-700",
    "bg-amber-700",
  ];
  const hash = userInfo.id?.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0) || 0;
  const bgColorClass = bgColors[hash % bgColors.length];

  return (
    <Tooltip label={t("runBy", { action, name: displayName })} withArrow position="top">
      <Avatar
        src={userInfo.avatar}
        alt={displayName}
        radius="xl"
        size={size}
        className={`${className} !h-[1.5rem] !w-[1.5rem] !min-w-[1.5rem] text-lg font-extrabold text-white ${bgColorClass}`}
        style={{ color: "#fff", textShadow: "0 1px 4px rgba(0,0,0,0.18)" }}
      >
        <span style={{ color: "#fff", fontWeight: 800, filter: "none" }}>{getInitials()}</span>
      </Avatar>
    </Tooltip>
  );
}
