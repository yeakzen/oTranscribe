const localStorageManager = require('local-storage-manager');
import defaultSettings from './defaults.json';

function getSettings() {
    const savedSettings = localStorageManager.getItem('oTranscribe-settings');
    let settings = Object.assign({}, defaultSettings);
    if (savedSettings) {
        settings = Object.assign({}, defaultSettings, savedSettings);
        settings.keyboardShortcuts = Object.assign({}, defaultSettings.keyboardShortcuts, savedSettings.keyboardShortcuts);
        settings.keyboardShortcuts.shortcuts = Object.assign(
            {},
            defaultSettings.keyboardShortcuts.shortcuts,
            savedSettings.keyboardShortcuts && savedSettings.keyboardShortcuts.shortcuts
        );
        settings.timestampOffsets = Object.assign({}, defaultSettings.timestampOffsets, savedSettings.timestampOffsets);
    }
    return settings;
}

export { getSettings, defaultSettings, localStorageManager };
