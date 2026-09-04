
> sdkmanager "platform-tools" "emulator" "platforms;android-36" "system-images;android-36;google_apis_playstore;arm64-v8a"
> avdmanager create avd -n pixel_9_pro -k "system-images;android-36;google_apis_playstore;arm64-v8a" --device "pixel_9_pro"
> emulator -avd pixel_9_pro
