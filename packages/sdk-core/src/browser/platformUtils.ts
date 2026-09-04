import { getDeviceByName, DEFAULT_DEVICE_NAME } from 'shiplight-types';
import { DevicePlatform } from './types';

export const getPlatformFromDeviceName = (deviceName?: string): DevicePlatform => {
  if (!deviceName || deviceName === DEFAULT_DEVICE_NAME) {
    return DevicePlatform.Desktop;
  }

  // Use playwright device definitions to get accurate platform info
  const device = getDeviceByName(deviceName);
  if (!device) {
    return DevicePlatform.Desktop;
  }

  // Use the isMobile flag from playwright device definitions
  return device.isMobile ? DevicePlatform.Mobile : DevicePlatform.Desktop;
};
