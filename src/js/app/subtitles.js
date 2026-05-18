import showMessage from './message-panel';
import { getSettings, localStorageManager } from './settings/store';

const $ = require('jquery');

const state = {
    cues: [],
    filename: '',
    currentIndex: -1,
    showCurrentText: true,
    pauseAtSentenceEnd: false,
    fontSize: 15,
    repeatActive: false,
    repeatCueIndex: -1,
    repeatTimer: null,
    displayTimer: null,
    sentenceEndTimer: null,
    activeSentenceIndex: -1,
    activeSentenceEnd: null
};

const TIMER_INTERVAL = 100;
const END_EPSILON = 0.05;

function getText(id, fallback) {
    const text = document.webL10n && document.webL10n.get(id);
    return text || fallback;
}

function showSubtitleMessage(id, fallback) {
    showMessage(getText(id, fallback));
}

function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsText(file);
    });
}

function parseTime(rawTime) {
    if (!rawTime) {
        return null;
    }
    const time = rawTime.trim().replace(',', '.');
    const parts = time.split(':');
    if (parts.length < 2 || parts.length > 3) {
        return null;
    }
    const seconds = parseFloat(parts.pop());
    const minutes = parseInt(parts.pop(), 10);
    const hours = parts.length ? parseInt(parts.pop(), 10) : 0;
    if ([seconds, minutes, hours].some(value => isNaN(value))) {
        return null;
    }
    return (hours * 3600) + (minutes * 60) + seconds;
}

function parseCueBlock(block, index) {
    const lines = block
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);

    if (!lines.length) {
        return null;
    }

    let timeLineIndex = lines.findIndex(line => line.indexOf('-->') > -1);
    if (timeLineIndex === -1) {
        return null;
    }

    const [startRaw, endAndSettings] = lines[timeLineIndex].split(/\s+-->\s+/);
    if (!endAndSettings) {
        return null;
    }
    const endRaw = endAndSettings.split(/\s+/)[0];
    const start = parseTime(startRaw);
    const end = parseTime(endRaw);
    if (start === null || end === null || end <= start) {
        return null;
    }

    const id = timeLineIndex > 0 ? lines[0] : String(index + 1);
    const text = lines
        .slice(timeLineIndex + 1)
        .join(' ')
        .replace(/<[^>]+>/g, '')
        .trim();

    if (!text) {
        return null;
    }

    return {
        id,
        start,
        end,
        text
    };
}

function parseSubtitles(rawText) {
    const text = rawText
        .replace(/^\uFEFF/, '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/^WEBVTT[^\n]*\n/i, '')
        .replace(/^NOTE[\s\S]*?(?=\n\n)/gm, '');

    return text
        .split(/\n{2,}/)
        .map(parseCueBlock)
        .filter(Boolean)
        .sort((a, b) => a.start - b.start);
}

function isSubtitleFile(file) {
    const name = (file && file.name || '').toLowerCase();
    const type = (file && file.type || '').toLowerCase();
    return name.match(/\.(srt|vtt)$/) || type === 'text/vtt' || type === 'application/x-subrip';
}

export function hasSubtitles() {
    return state.cues.length > 0;
}

export function loadSubtitleFile(file) {
    if (!isSubtitleFile(file)) {
        showSubtitleMessage('subtitle-unsupported', 'Please upload an SRT or VTT subtitle file.');
        return Promise.reject(new Error('Unsupported subtitle format'));
    }

    return readFileAsText(file)
        .then(contents => {
            const cues = parseSubtitles(contents);
            if (!cues.length) {
                showSubtitleMessage('subtitle-empty', 'No usable subtitle cues were found.');
                throw new Error('No usable subtitle cues found');
            }
            resetSubtitleData();
            state.cues = cues;
            state.filename = file.name;
            localStorageManager.setItem('oT-lastsubtitles', file.name);
            syncSubtitleUI();
            updateSubtitleDisplay();
            return cues;
        })
        .catch(err => {
            if (err.message !== 'No usable subtitle cues found') {
                showSubtitleMessage('subtitle-error', 'Could not read this subtitle file.');
            }
            throw err;
        });
}

export function clearSubtitles(opts = {}) {
    cancelRepeat();
    clearInterval(state.displayTimer);
    clearInterval(state.sentenceEndTimer);
    state.displayTimer = null;
    state.sentenceEndTimer = null;
    resetSubtitleData();
    if (!opts.keepSettings) {
        initSubtitleSettings();
    }
    syncSubtitleUI();
    updateSubtitleDisplay();
}

function resetSubtitleData() {
    cancelRepeat();
    state.cues = [];
    state.filename = '';
    state.currentIndex = -1;
    state.activeSentenceIndex = -1;
    state.activeSentenceEnd = null;
}

export function initSubtitleSettings() {
    const subtitles = getSettings().subtitles || {};
    state.showCurrentText = subtitles.showCurrentText !== false;
    state.pauseAtSentenceEnd = subtitles.pauseAtSentenceEnd === true;
    state.fontSize = subtitles.fontSize || 15;
    applySubtitleSize();
    syncSubtitleUI();
}

function saveSubtitleSetting(key, value) {
    const settings = getSettings();
    const subtitles = Object.assign({}, settings.subtitles, {
        [key]: value
    });
    localStorageManager.setItem('oTranscribe-settings', Object.assign({}, settings, {
        subtitles
    }));
}

function getCueIndexAt(time) {
    if (!hasSubtitles()) {
        return -1;
    }
    for (let i = 0; i < state.cues.length; i++) {
        const cue = state.cues[i];
        if (time >= cue.start && time < cue.end) {
            return i;
        }
    }
    for (let i = state.cues.length - 1; i >= 0; i--) {
        if (time >= state.cues[i].start) {
            return i;
        }
    }
    return -1;
}

function getNextCueIndex(time) {
    return state.cues.findIndex(cue => cue.start > time + END_EPSILON);
}

export function getCueAt(time) {
    const index = getCueIndexAt(time);
    return index > -1 ? state.cues[index] : null;
}

export function getCurrentIndex(player) {
    return player ? getCueIndexAt(player.getTime()) : -1;
}

export function getCurrentCue(player) {
    const index = getCurrentIndex(player);
    return index > -1 ? state.cues[index] : null;
}

function requireSubtitles() {
    if (hasSubtitles()) {
        return true;
    }
    showSubtitleMessage('subtitle-required', 'Upload a subtitle file first.');
    return false;
}

function seekAndPlay(player, cue) {
    cancelRepeat();
    state.activeSentenceIndex = -1;
    state.activeSentenceEnd = null;
    player.setTime(cue.start);
    player.playDirect();
}

export function jumpToPrevious(player) {
    if (!player || !requireSubtitles()) {
        return;
    }
    const time = player.getTime();
    const index = getCueIndexAt(time);
    let targetIndex = 0;
    if (index > -1) {
        const currentCue = state.cues[index];
        const sentenceMidpoint = currentCue.start + ((currentCue.end - currentCue.start) / 2);
        targetIndex = time > sentenceMidpoint ? index : Math.max(index - 1, 0);
    }
    seekAndPlay(player, state.cues[targetIndex]);
}

export function jumpToNext(player) {
    if (!player || !requireSubtitles()) {
        return;
    }
    const time = player.getTime();
    const index = getCueIndexAt(time);
    let targetIndex = getNextCueIndex(time);
    if (index > -1) {
        targetIndex = Math.min(index + 1, state.cues.length - 1);
    } else if (targetIndex === -1) {
        targetIndex = state.cues.length - 1;
    }
    seekAndPlay(player, state.cues[targetIndex]);
}

export function repeatCurrent(player) {
    if (!player || !requireSubtitles()) {
        return;
    }
    const cueIndex = getCurrentIndex(player);
    if (cueIndex === -1) {
        showSubtitleMessage('subtitle-required', 'Upload a subtitle file first.');
        return;
    }
    cancelRepeat();
    const cue = state.cues[cueIndex];
    state.repeatActive = true;
    state.repeatCueIndex = cueIndex;
    player.setTime(cue.start);
    player.playDirect();
    state.repeatTimer = setInterval(() => {
        if (!state.repeatActive) {
            return;
        }
        if (player.getTime() >= cue.end - END_EPSILON) {
            player.pause();
            cancelRepeat();
        }
    }, TIMER_INTERVAL);
}

function cancelRepeat() {
    clearInterval(state.repeatTimer);
    state.repeatTimer = null;
    state.repeatActive = false;
    state.repeatCueIndex = -1;
}

export function setSubtitleVisible(visible) {
    state.showCurrentText = visible;
    saveSubtitleSetting('showCurrentText', visible);
    syncSubtitleUI();
    updateSubtitleDisplay();
}

export function toggleSubtitleVisible() {
    setSubtitleVisible(!state.showCurrentText);
}

export function setPauseAtSentenceEnd(enabled) {
    state.pauseAtSentenceEnd = enabled;
    state.activeSentenceIndex = -1;
    state.activeSentenceEnd = null;
    saveSubtitleSetting('pauseAtSentenceEnd', enabled);
    syncSubtitleUI();
}

export function togglePauseAtSentenceEnd() {
    setPauseAtSentenceEnd(!state.pauseAtSentenceEnd);
}

export function setSubtitleFontSize(size) {
    const parsedSize = parseInt(size, 10);
    state.fontSize = isNaN(parsedSize) ? 15 : Math.min(28, Math.max(12, parsedSize));
    saveSubtitleSetting('fontSize', state.fontSize);
    applySubtitleSize();
    syncSubtitleUI();
}

function applySubtitleSize() {
    $('.subtitle-current').css('font-size', `${state.fontSize}px`);
}

function updateSubtitleDisplay(player) {
    const $display = $('.subtitle-current');
    if (!$display.length) {
        return;
    }
    if (!state.showCurrentText || !hasSubtitles() || !player) {
        $display.addClass('hidden').text('');
        state.currentIndex = -1;
        return;
    }
    const index = getCurrentIndex(player);
    state.currentIndex = index;
    if (index === -1) {
        $display.addClass('hidden').text('');
        return;
    }
    $display.text(state.cues[index].text).removeClass('hidden');
}

export function bindSubtitleDisplay(player) {
    clearInterval(state.displayTimer);
    state.displayTimer = setInterval(() => {
        updateSubtitleDisplay(player);
    }, TIMER_INTERVAL);
    updateSubtitleDisplay(player);
}

export function bindSentenceEndPause(player) {
    clearInterval(state.sentenceEndTimer);
    state.sentenceEndTimer = setInterval(() => {
        if (!player || !state.pauseAtSentenceEnd || !hasSubtitles() || state.repeatActive) {
            return;
        }
        if (player.getStatus() !== 'playing') {
            state.activeSentenceIndex = -1;
            state.activeSentenceEnd = null;
            return;
        }
        const time = player.getTime();
        const currentIndex = getCueIndexAt(time);
        if (
            currentIndex !== -1 &&
            currentIndex !== state.activeSentenceIndex &&
            time < state.cues[currentIndex].end - END_EPSILON
        ) {
            state.activeSentenceIndex = currentIndex;
            state.activeSentenceEnd = state.cues[currentIndex].end;
        }
        if (state.activeSentenceIndex === -1 || time > state.activeSentenceEnd + END_EPSILON) {
            const index = currentIndex;
            if (index === -1 || time >= state.cues[index].end - END_EPSILON) {
                const nextIndex = getNextCueIndex(time);
                state.activeSentenceIndex = nextIndex;
                state.activeSentenceEnd = nextIndex > -1 ? state.cues[nextIndex].end : null;
                return;
            }
            state.activeSentenceIndex = index;
            state.activeSentenceEnd = state.cues[index].end;
        }
        if (state.activeSentenceEnd !== null && time >= state.activeSentenceEnd - END_EPSILON) {
            player.pause();
            state.activeSentenceIndex = -1;
            state.activeSentenceEnd = null;
        }
    }, TIMER_INTERVAL);
}

export function setupSubtitleControls() {
    initSubtitleSettings();
    $('.subtitle-upload-input').off().on('change', function() {
        const file = this.files[0];
        if (file) {
            loadSubtitleFile(file).catch(() => {});
        }
        this.value = '';
    });
    $('.subtitle-visible-toggle').off().on('change', function() {
        setSubtitleVisible(this.checked);
    });
    $('.sentence-end-pause-toggle').off().on('change', function() {
        setPauseAtSentenceEnd(this.checked);
    });
    $('.subtitle-size-slider').off().on('input change', function() {
        setSubtitleFontSize(this.value);
    });
    syncSubtitleUI();
}

export function syncSubtitleUI() {
    $('.subtitle-tool').toggleClass('active', hasSubtitles());
    $('.subtitle-filename').text(state.filename || getText('no-subtitles', 'No subtitles loaded'));
    $('.subtitle-visible-toggle').prop('checked', state.showCurrentText).prop('disabled', !hasSubtitles());
    $('.sentence-end-pause-toggle').prop('checked', state.pauseAtSentenceEnd).prop('disabled', !hasSubtitles());
    $('.subtitle-size-slider').val(state.fontSize);
    $('.sentence-control').toggleClass('disabled', !hasSubtitles());
}
