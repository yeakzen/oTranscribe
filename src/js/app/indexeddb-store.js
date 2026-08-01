const legacyLocalStorageManager = require('local-storage-manager');

const DB_NAME = 'oTranscribe';
const DB_VERSION = 1;
const STORE_NAME = 'items';
const LEGACY_PREFIX = 'localStorageManager_';
const LEGACY_AUTOSAVE_KEY = 'autosave';
const LEGACY_BACKUP_PREFIX = 'oTranscribe-backup-';

let db = null;
let readyPromise = null;
let useFallback = false;
let cache = {};
let writeQueue = Promise.resolve();

function getTimestamp() {
    return new Date().getTime();
}

function cloneItem(item) {
    return {
        key: item.key,
        value: item.value,
        timestamp: item.timestamp || null
    };
}

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = window.indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = event => {
            const database = event.target.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME, { keyPath: 'key' });
            }
        };
        request.onsuccess = event => resolve(event.target.result);
        request.onerror = event => reject(event.target.error);
    });
}

function requestToPromise(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = event => resolve(event.target.result);
        request.onerror = event => reject(event.target.error);
    });
}

function getStore(mode) {
    return db
        .transaction(STORE_NAME, mode)
        .objectStore(STORE_NAME);
}

function loadCache() {
    return requestToPromise(getStore('readonly').getAll()).then(items => {
        cache = {};
        (items || []).forEach(item => {
            cache[item.key] = cloneItem(item);
        });
    });
}

function persistItem(item) {
    if (useFallback) {
        legacyLocalStorageManager.setItem(item.key, item.value);
        return Promise.resolve();
    }
    writeQueue = writeQueue.then(() => (
        requestToPromise(getStore('readwrite').put(cloneItem(item)))
    )).catch(error => {
        handleSaveError(error);
    });
    return writeQueue;
}

function deleteItem(key) {
    if (useFallback) {
        legacyLocalStorageManager.removeItem(key);
        return Promise.resolve();
    }
    writeQueue = writeQueue.then(() => (
        requestToPromise(getStore('readwrite').delete(key))
    )).catch(error => {
        handleSaveError(error);
    });
    return writeQueue;
}

function handleSaveError(error) {
    console.error('Problem saving to IndexedDB.', error);
    if (indexedDBStorageManager.onSaveFailure) {
        indexedDBStorageManager.onSaveFailure();
    }
}

function parseLegacyItem(key, rawValue) {
    if (key.indexOf(LEGACY_PREFIX) === 0) {
        try {
            const parsed = JSON.parse(rawValue);
            return {
                key: key.replace(LEGACY_PREFIX, ''),
                value: parsed.value,
                timestamp: parsed.timestamp || getTimestamp()
            };
        } catch (e) {
            return null;
        }
    }
    if (key === LEGACY_AUTOSAVE_KEY) {
        return {
            key,
            value: rawValue,
            timestamp: getTimestamp()
        };
    }
    if (key.indexOf(LEGACY_BACKUP_PREFIX) === 0) {
        return {
            key,
            value: rawValue,
            timestamp: key.split('-')[2] || getTimestamp()
        };
    }
    return null;
}

function collectLegacyItems() {
    const items = [];
    for (let i = 0; i < localStorage.length; i++) {
        const localStorageKey = localStorage.key(i);
        const item = parseLegacyItem(localStorageKey, localStorage.getItem(localStorageKey));
        if (item) {
            items.push({
                item,
                localStorageKey
            });
        }
    }
    return items;
}

function importLegacyStorage() {
    if (useFallback) {
        return Promise.resolve();
    }
    const legacyItems = collectLegacyItems();
    if (!legacyItems.length) {
        return Promise.resolve();
    }
    return legacyItems.reduce((promise, legacy) => (
        promise.then(() => {
            if (cache[legacy.item.key]) {
                localStorage.removeItem(legacy.localStorageKey);
                return Promise.resolve();
            }
            return requestToPromise(getStore('readwrite').put(cloneItem(legacy.item))).then(() => {
                cache[legacy.item.key] = cloneItem(legacy.item);
                localStorage.removeItem(legacy.localStorageKey);
            });
        })
    ), Promise.resolve());
}

function importLegacyStorageToFallback() {
    collectLegacyItems().forEach(legacy => {
        if (!legacyLocalStorageManager.getItem(legacy.item.key)) {
            legacyLocalStorageManager.setItem(legacy.item.key, legacy.item.value);
        }
        if (legacy.localStorageKey.indexOf(LEGACY_PREFIX) !== 0) {
            localStorage.removeItem(legacy.localStorageKey);
        }
    });
}

function sortItems(items) {
    return items.sort((a, b) => {
        if (a.timestamp !== b.timestamp) {
            return (a.timestamp || 0) - (b.timestamp || 0);
        }
        return a.key < b.key ? -1 : 1;
    });
}

function initIndexedDBStore() {
    if (readyPromise) {
        return readyPromise;
    }
    if (!window.indexedDB) {
        useFallback = true;
        importLegacyStorageToFallback();
        window.localStorageManager = legacyLocalStorageManager;
        readyPromise = Promise.resolve();
        return readyPromise;
    }
    readyPromise = openDatabase()
        .then(database => {
            db = database;
            return loadCache();
        })
        .then(importLegacyStorage)
        .then(() => {
            window.localStorageManager = indexedDBStorageManager;
            return indexedDBStorageManager;
        })
        .catch(error => {
            console.error('Problem opening IndexedDB. Falling back to localStorage.', error);
            useFallback = true;
            importLegacyStorageToFallback();
            window.localStorageManager = legacyLocalStorageManager;
            return legacyLocalStorageManager;
        });
    return readyPromise;
}

const indexedDBStorageManager = {
    identifier: LEGACY_PREFIX.replace(/_$/, ''),
    onFull: null,
    onSaveFailure: null,
    setItem(key, value) {
        if (useFallback) {
            legacyLocalStorageManager.setItem(key, value);
            return;
        }
        const item = {
            key,
            value,
            timestamp: getTimestamp()
        };
        cache[key] = cloneItem(item);
        persistItem(item);
    },
    getItem(key) {
        if (useFallback) {
            return legacyLocalStorageManager.getItem(key);
        }
        const item = this.getItemMetadata(key);
        if (item) {
            return item.value;
        }
        return null;
    },
    getItemMetadata(key) {
        if (useFallback) {
            return legacyLocalStorageManager.getItemMetadata(key);
        }
        const item = cache[key];
        return item ? cloneItem(item) : null;
    },
    removeItem(key) {
        if (useFallback) {
            legacyLocalStorageManager.removeItem(key);
            return;
        }
        delete cache[key];
        deleteItem(key);
    },
    getArray() {
        if (useFallback) {
            return legacyLocalStorageManager.getArray();
        }
        return sortItems(Object.keys(cache).map((key, index) => {
            const item = cache[key];
            return {
                key,
                value: item.value,
                timestamp: item.timestamp || null,
                index
            };
        }));
    },
    getAll(opts = {}) {
        if (useFallback) {
            return legacyLocalStorageManager.getAll(opts);
        }
        const array = this.getArray();
        if (opts.format === 'array') {
            return array;
        }
        return array.reduce((all, item) => {
            all[item.key] = item.value;
            return all;
        }, {});
    },
    getFirst() {
        if (useFallback) {
            return legacyLocalStorageManager.getFirst();
        }
        return this.getArray()[0];
    },
    ready() {
        return initIndexedDBStore();
    },
    flush() {
        return writeQueue;
    }
};

export { initIndexedDBStore, indexedDBStorageManager as localStorageManager };
