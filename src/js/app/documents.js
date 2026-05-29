const $ = require('jquery');
const localStorageManager = require('local-storage-manager');
import { setEditorContents } from './texteditor';
import showMessage from './message-panel';
import { serializeMarkdownBlocks } from './markdown-blocks';

const INDEX_KEY = 'oTranscribe-documents-index';
const CURRENT_KEY = 'oTranscribe-current-document';
const LEGACY_AUTOSAVE_KEY = 'autosave';
const DEFAULT_TITLE = 'Untitled transcript';
const EMPTY_CONTENT = '';

let activeDocumentId = null;
let beforeSwitch = null;
let shouldLoadCurrentDocument = true;

function now() {
    return new Date().getTime();
}

function createId() {
    return 'doc-' + now() + '-' + Math.floor(Math.random() * 100000);
}

function getTexteditorContents() {
    const textbox = document.querySelector('#textbox');
    return textbox ? serializeMarkdownBlocks(textbox) : '';
}

function getDocumentContentKey(id) {
    return `oTranscribe-document-${id}-autosave`;
}

function getDocumentBackupPrefix(id) {
    return `oTranscribe-document-${id}-backup-`;
}

function readIndex() {
    const index = localStorageManager.getItem(INDEX_KEY);
    return Array.isArray(index) ? index : [];
}

function writeIndex(index) {
    localStorageManager.setItem(INDEX_KEY, index);
}

function sortIndex(index) {
    return index.sort((a, b) => (b.lastOpenedAt || b.updatedAt || 0) - (a.lastOpenedAt || a.updatedAt || 0));
}

function getDocumentTitleFromHTML(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html || '';
    const text = (tmp.textContent || tmp.innerText || '').replace(/\s+/g, ' ').trim();
    if (!text) {
        return DEFAULT_TITLE;
    }
    return text.slice(0, 48);
}

function getDocument(id) {
    return readIndex().filter(doc => doc.id === id)[0] || null;
}

function updateDocument(id, changes) {
    const index = readIndex();
    let changed = false;
    let shouldRender = false;
    const updated = index.map(doc => {
        if (doc.id !== id) {
            return doc;
        }
        changed = true;
        shouldRender = (
            (changes.title !== undefined && changes.title !== doc.title) ||
            changes.lastOpenedAt !== undefined ||
            changes.hasCustomTitle !== undefined
        );
        return Object.assign({}, doc, changes);
    });
    if (!changed) {
        return;
    }
    writeIndex(sortIndex(updated));
    if (shouldRender) {
        renderDocumentUI();
    }
}

function setCurrentDocumentId(id) {
    activeDocumentId = id;
    localStorageManager.setItem(CURRENT_KEY, id);
}

function getCurrentDocumentId() {
    if (!activeDocumentId) {
        activeDocumentId = localStorageManager.getItem(CURRENT_KEY);
    }
    return activeDocumentId;
}

function createDocument(opts = {}) {
    const timestamp = now();
    const doc = {
        id: createId(),
        title: opts.title || getDocumentTitleFromHTML(opts.content),
        hasCustomTitle: !!opts.title,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastOpenedAt: timestamp
    };
    const index = readIndex();
    index.push(doc);
    writeIndex(sortIndex(index));
    localStorageManager.setItem(getDocumentContentKey(doc.id), opts.content || '');
    return doc;
}

function saveCurrentDocument(content = getTexteditorContents()) {
    const id = getCurrentDocumentId();
    if (!id) {
        return;
    }
    const doc = getDocument(id);
    if (!doc) {
        return;
    }
    const timestamp = now();
    localStorageManager.setItem(getDocumentContentKey(id), content);
    const changes = { updatedAt: timestamp };
    if (!doc.hasCustomTitle) {
        changes.title = getDocumentTitleFromHTML(content);
    }
    updateDocument(id, changes);
}

function getCurrentDocumentContents() {
    const id = getCurrentDocumentId();
    if (!id) {
        return '';
    }
    return localStorageManager.getItem(getDocumentContentKey(id)) || '';
}

function createDocumentFromCurrentEditor() {
    saveCurrentDocument();
    const doc = createDocument({
        content: EMPTY_CONTENT
    });
    switchDocument(doc.id);
}

function switchDocument(id, opts = {}) {
    if (id === getCurrentDocumentId() && !opts.force) {
        return;
    }
    if (opts.skipSave) {
        // current document was already handled by the caller
    } else if (beforeSwitch) {
        beforeSwitch();
    } else if (getCurrentDocumentId()) {
        saveCurrentDocument();
    }
    const doc = getDocument(id);
    if (!doc) {
        return;
    }
    setCurrentDocumentId(id);
    updateDocument(id, { lastOpenedAt: now() });
    const contents = localStorageManager.getItem(getDocumentContentKey(id)) || '';
    setEditorContents(contents, { transition: opts.transition });
    closePanel();
}

function renameDocument(id) {
    const doc = getDocument(id);
    if (!doc) {
        return;
    }
    const nextTitle = window.prompt('Document name', doc.title || DEFAULT_TITLE);
    if (!nextTitle) {
        return;
    }
    updateDocument(id, {
        title: nextTitle.trim().slice(0, 80) || DEFAULT_TITLE,
        hasCustomTitle: true,
        updatedAt: now()
    });
}

function removeDocument(id) {
    const index = readIndex();
    if (index.length <= 1) {
        showMessage('Keep at least one document.');
        return;
    }
    const doc = getDocument(id);
    if (!doc) {
        return;
    }
    if (!window.confirm(`Delete "${doc.title || DEFAULT_TITLE}"? This will also delete its history.`)) {
        return;
    }
    localStorageManager.removeItem(getDocumentContentKey(id));
    removeBackupsForDocument(id);
    const nextIndex = index.filter(item => item.id !== id);
    writeIndex(sortIndex(nextIndex));
    if (id === getCurrentDocumentId()) {
        setCurrentDocumentId(nextIndex[0].id);
        switchDocument(nextIndex[0].id, { force: true, skipSave: true });
    } else {
        renderDocumentUI();
    }
}

function removeBackupsForDocument(id) {
    const prefix = getDocumentBackupPrefix(id);
    const items = localStorageManager.getArray();
    for (let i = 0; i < items.length; i++) {
        if (items[i].key.indexOf(prefix) === 0) {
            localStorageManager.removeItem(items[i].key);
        }
    }
}

function migrateLegacyDocument() {
    migrateRawLegacyStorage();
    const existingIndex = readIndex();
    if (existingIndex.length) {
        const storedCurrent = localStorageManager.getItem(CURRENT_KEY);
        const first = getDocument(storedCurrent) || existingIndex[0];
        setCurrentDocumentId(first.id);
        shouldLoadCurrentDocument = true;
        return;
    }

    let legacyContents = '';
    let hasLegacyContents = false;
    try {
        const storedLegacyContents = localStorageManager.getItem(LEGACY_AUTOSAVE_KEY);
        if (storedLegacyContents) {
            legacyContents = storedLegacyContents;
            hasLegacyContents = true;
        }
    } catch (e) {
        legacyContents = '';
    }
    if (!hasLegacyContents) {
        legacyContents = getTexteditorContents();
        shouldLoadCurrentDocument = false;
    } else {
        shouldLoadCurrentDocument = true;
    }

    const doc = createDocument({
        title: hasLegacyContents ? getDocumentTitleFromHTML(legacyContents) : DEFAULT_TITLE,
        content: legacyContents
    });
    setCurrentDocumentId(doc.id);
    migrateLegacyBackups(doc.id);
}

function migrateLegacyBackups(id) {
    const items = localStorageManager.getArray();
    for (let i = 0; i < items.length; i++) {
        const key = items[i].key;
        if (key.indexOf('oTranscribe-backup-') === 0) {
            const timestamp = key.split('-')[2];
            localStorageManager.setItem(getDocumentBackupPrefix(id) + timestamp, items[i].value);
            localStorageManager.removeItem(key);
        }
    }
}

function migrateRawLegacyStorage() {
    if (localStorage.getItem(LEGACY_AUTOSAVE_KEY)) {
        localStorageManager.setItem(LEGACY_AUTOSAVE_KEY, localStorage.getItem(LEGACY_AUTOSAVE_KEY));
    }
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.indexOf('oTranscribe-backup') === 0) {
            const item = {
                value: localStorage.getItem(key),
                timestamp: key.split('-')[2]
            };
            localStorage.setItem('localStorageManager_' + key, JSON.stringify(item));
            localStorage.removeItem(key);
            i -= 1;
        }
    }
}

function renderDocumentUI() {
    const currentId = getCurrentDocumentId();
    const current = getDocument(currentId);
    $('.document-current-title').text((current && current.title) || DEFAULT_TITLE);
    const list = $('.document-list');
    if (!list.length) {
        return;
    }
    list.empty();
    readIndex().forEach(doc => {
        const row = $('<div class="document-row"></div>');
        const title = $('<button type="button" class="document-title"></button>');
        const rename = $('<button type="button" class="document-action document-rename" title="Rename"><i class="fa fa-pencil"></i></button>');
        const del = $('<button type="button" class="document-action document-delete" title="Delete"><i class="fa fa-trash"></i></button>');
        title.text(doc.title || DEFAULT_TITLE);
        row.toggleClass('active', doc.id === currentId);
        title.on('click', () => switchDocument(doc.id, { transition: true }));
        rename.on('click', () => renameDocument(doc.id));
        del.on('click', () => removeDocument(doc.id));
        row.append(title, rename, del);
        list.append(row);
    });
}

function closePanel() {
    $('.documents-panel').removeClass('active');
}

function openPanel() {
    renderDocumentUI();
    $('.documents-panel').toggleClass('active');
}

function initDocuments(opts = {}) {
    beforeSwitch = opts.beforeSwitch || null;
    migrateLegacyDocument();
    if (shouldLoadCurrentDocument) {
        setEditorContents(getCurrentDocumentContents());
    }
    renderDocumentUI();

    $('.sbutton.documents').on('click', function(e) {
        e.preventDefault();
        openPanel();
    });
    $('.document-new').on('click', function(e) {
        e.preventDefault();
        createDocumentFromCurrentEditor();
    });
    $('.document-close').on('click', function(e) {
        e.preventDefault();
        closePanel();
    });
    $('.textbox-container').on('click', function(e) {
        if (
            $(e.target).closest('.documents-panel').length ||
            $(e.target).closest('.sbutton.documents').length
        ) {
            return;
        }
        closePanel();
    });
}

export {
    initDocuments,
    getCurrentDocumentId,
    getDocumentBackupPrefix,
    saveCurrentDocument,
    createDocument,
    switchDocument,
    renderDocumentUI,
    getCurrentDocumentContents
};
