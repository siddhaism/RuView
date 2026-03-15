export default {
  name: 'WiFi-DensePose',
  slug: 'wifi-densepose',
  version: '1.0.0',
  plugins: ['expo-notifications'],
  ios: {
    bundleIdentifier: 'com.ruvnet.wifidensepose',
    infoPlist: {
      UIBackgroundModes: ['remote-notification'],
    },
  },
  android: {
    package: 'com.ruvnet.wifidensepose',
  },
};
