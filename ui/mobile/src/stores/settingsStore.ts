import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { notificationService } from '@/services/notification.service';

export type Theme = 'light' | 'dark' | 'system';

export interface SettingsState {
  serverUrl: string;
  rssiScanEnabled: boolean;
  theme: Theme;
  alertSoundEnabled: boolean;
  notificationsEnabled: boolean;
  setServerUrl: (url: string) => void;
  setRssiScanEnabled: (value: boolean) => void;
  setTheme: (theme: Theme) => void;
  setAlertSoundEnabled: (value: boolean) => void;
  setNotificationsEnabled: (value: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      serverUrl: 'http://localhost:3000',
      rssiScanEnabled: false,
      theme: 'system',
      alertSoundEnabled: true,
      notificationsEnabled: true,

      setServerUrl: (url) => {
        set({ serverUrl: url });
      },

      setRssiScanEnabled: (value) => {
        set({ rssiScanEnabled: value });
      },

      setTheme: (theme) => {
        set({ theme });
      },

      setAlertSoundEnabled: (value) => {
        set({ alertSoundEnabled: value });
      },

      setNotificationsEnabled: (value) => {
        set({ notificationsEnabled: value });
        notificationService.updateServerSettings(get().serverUrl, value);
      },
    }),
    {
      name: 'wifi-densepose-settings',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
