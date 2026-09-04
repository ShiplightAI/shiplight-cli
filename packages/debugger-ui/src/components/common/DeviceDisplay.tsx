import { BrowserType, PLAYWRIGHT_DEVICES, type PlaywrightDevice } from 'shiplight-types';
import { Tooltip } from '@mantine/core';
import { IconBrandChrome, IconBrandFirefox, IconBrandSafari, IconDeviceDesktop, IconDeviceMobile } from '@tabler/icons-react';
import { useTranslations } from 'next-intl';

interface DeviceDisplayProps {
  deviceName?: string;
  className?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}

const DeviceDisplay = ({
  deviceName = 'Desktop Chrome',
  className = '',
  size = 'sm'
}: DeviceDisplayProps) => {
  const t = useTranslations("DeviceDisplay");
  const device: PlaywrightDevice | undefined = PLAYWRIGHT_DEVICES[deviceName || 'Desktop Chrome'];

  const getDevicePlatform = (device?: PlaywrightDevice) => {
    if (!device) {
      return <IconDeviceDesktop size={16} />;
    }
    return device.isMobile ? <IconDeviceMobile size={16} /> : <IconDeviceDesktop size={16} />;
  };

  const getDeviceBrowserType = (device?: PlaywrightDevice) => {
    if (!device) {
      return <IconBrandChrome size={16} />;
    }
    if (device.defaultBrowserType === BrowserType.Chromium) {
      return <IconBrandChrome size={16} />;
    }
    if (device.defaultBrowserType === BrowserType.Webkit) {
      return <IconBrandSafari size={16} />;
    }
    if (device.defaultBrowserType === BrowserType.Firefox) {
      return <IconBrandFirefox size={16} />;
    }
    return null;
  };

  const renderDeviceInfo = (device?: PlaywrightDevice) => {
    if (!device) {
      return (
        <div>
          <strong>{t("device")}:</strong> {deviceName} ({t("defaultBrowserConfig")})
        </div>
      );
    }

    return (
      <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
        <div className="font-medium">{t("device")}:</div>
        <div>{device.displayName || device.name}</div>
        <div className="font-medium">{t("screen")}:</div>
        <div>{device.screen.width}×{device.screen.height}</div>
        <div className="font-medium">{t("viewport")}:</div>
        <div>{device.viewport.width}×{device.viewport.height}</div>
        <div className="font-medium">{t("scaleFactor")}:</div>
        <div>{device.deviceScaleFactor}x</div>
        <div className="font-medium">{t("type")}:</div>
        <div>{device.isMobile ? t("mobile") : t("desktop")}</div>
        <div className="font-medium">{t("touchSupport")}:</div>
        <div>{device.hasTouch ? t("yes") : t("no")}</div>
        <div className="font-medium">{t("userAgent")}:</div>
        <div className="break-all">{device.userAgent}</div>
      </div>
    );
  };

  return (
    <Tooltip
      label={renderDeviceInfo(device)}
      position="top"
      withArrow
      multiline
      maw={400}
      color='var(--mantine-color-dark-6)'
      p='md'
      styles={{
        tooltip: {
          lineHeight: '1.4'
        }
      }}
    >
      <div className={`inline-flex items-center gap-1 ${className}`}>
        {getDevicePlatform(device)}
        {getDeviceBrowserType(device)}
      </div>
    </Tooltip>
  );
};

export default DeviceDisplay;
