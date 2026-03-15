import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

class NotificationService {
  private token: string | null = null;

  async initialize(): Promise<string | null> {
    if (!Device.isDevice) {
      console.warn('Push notifications require a physical device');
      return null;
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.warn('Push notification permission not granted');
      return null;
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const tokenData = await Notifications.getExpoPushTokenAsync({
      ...(projectId ? { projectId } : {}),
    });
    this.token = tokenData.data;
    return this.token;
  }

  async registerWithServer(serverUrl: string): Promise<void> {
    if (!this.token) return;
    try {
      const url = `${serverUrl.replace(/\/$/, '')}/api/v1/notifications/register`;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: this.token }),
      });
    } catch (error) {
      console.warn('Failed to register push token with server:', error);
    }
  }

  async updateServerSettings(serverUrl: string, enabled: boolean): Promise<void> {
    try {
      const url = `${serverUrl.replace(/\/$/, '')}/api/v1/notifications/settings`;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
    } catch (error) {
      console.warn('Failed to update notification settings:', error);
    }
  }
}

export const notificationService = new NotificationService();
