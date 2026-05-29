/******************************************
             Initialisation
******************************************/

const $ = require('jquery');
let otrQueryParams = {};

import { watchFormatting, watchWordCount, initAutoscroll } from './texteditor';
import { inputSetup, getQueryParams, hide as inputHide } from './input';
import oldBrowserCheck from './old-browsers';
import languageSetup from './languages';
import { createPlayer, playerDrivers, getPlayer, isVideoFormat } from './player/player';
import { bindPlayerToUI, keyboardShortcutSetup } from './ui';
import { activateTimestamps, insertTimestamp, insertTimestampPreviousSecond, highlightTimestamps, clearHighlightedTimestamps, convertTimestampToSeconds } from './timestamps';
import { initBackup } from './backup';
import { initDocuments, saveCurrentDocument } from './documents';
import { exportSetup } from './export';
import importSetup from './import';
import viewController from './view-controller';
import { clearSubtitles, setupSubtitleControls } from './subtitles';
import { setupMarkdownBlocks } from './markdown-blocks';

export default function init(){
    initDocuments({
        beforeSwitch: () => saveCurrentDocument()
    });
    initBackup();
    watchFormatting();
    languageSetup();
    activateTimestamps();
    exportSetup();
    importSetup();
    setupSubtitleControls();
    setupMarkdownBlocks();
    initAutoscroll();

    // this is necessary due to execCommand restrictions
    // see: http://stackoverflow.com/a/33321235
    window.insertTimestamp = insertTimestamp;
    window.insertTimestampPreviousSecond = insertTimestampPreviousSecond;
    window.highlightTimestamps = highlightTimestamps;
    window.clearHighlightedTimestamps = clearHighlightedTimestamps;
    
    keyboardShortcutSetup();

    viewController.set('about');

    // Gather query parameters into an object
    otrQueryParams = getQueryParams();

    // If the ?v=<VIDEO_ID> parameter is found in the URL, auto load YouTube video
    if ( otrQueryParams['v'] ){
        $('.start').removeClass('ready');
        setMediaLayout('video');
        createPlayer({
            driver: playerDrivers.YOUTUBE,
            source: "https://www.youtube.com/watch?v=" + otrQueryParams.v
        }).then((player) => {
            inputHide();
            viewController.set('editor');
            bindPlayerToUI();
            let timestamp = otrQueryParams['t']; 
            if ( timestamp ){
                // Is the timestamp in HH:MM::SS format?
                if ( ~timestamp.indexOf(":") ){
                    timestamp = convertTimestampToSeconds(timestamp);
                } 
                player.driver._ytEl.seekTo(timestamp);
            }
        });

    } else {

        if ( localStorageManager.getItem("oT-lastfile") ) {
            viewController.set('editor');
        }
        
    }

    $('.title').mousedown(() => {
        if (viewController.is('about')) {
            viewController.set('editor');
        } else {
            viewController.set('about');
        }
    });
    $('.settings-button').mousedown(() => {
        if (viewController.is('settings')) {
            viewController.set('editor');
        } else {
            viewController.set('settings');
        }
    });

}

function setMediaLayout(type) {
    $('.textbox-container')
        .removeClass('media-audio media-video')
        .addClass(type ? `media-${type}` : '');
}

// note: this function may run multiple times
function onLocalized() {
    const resetInput = inputSetup({
        create: file => {
            clearSubtitles();
            const driver = isVideoFormat(file) ? playerDrivers.HTML5_VIDEO : playerDrivers.HTML5_AUDIO;
            setMediaLayout(isVideoFormat(file) ? 'video' : 'audio');
		    createPlayer({
		        driver: driver,
		        source: window.URL.createObjectURL(file),
                name: file.name
		    }).then(() => {
                bindPlayerToUI(file.name);
		    });
        },
        createFromURL: url => {
            clearSubtitles();
            setMediaLayout('video');
		    createPlayer({
		        driver: playerDrivers.YOUTUBE,
		        source: url
		    }).then(() => {
                bindPlayerToUI();
		    });
        }
    });
    
    watchWordCount();

    var startText = document.webL10n.get('start-ready');
    $('.start')
        // .addClass('ready')
        .toggleClass('ready', !otrQueryParams.v)    // Show 'Loading...' text if a video is to be automatically initialized
        .off()
        .click(() => {
            viewController.set('editor');
        });
    
    $('.reset').off().on('click', () => {
        const player = getPlayer();
        resetInput();
        clearSubtitles();
        setMediaLayout(null);
        if (player) {
            player.destroy();
        }
    });
    
    oldBrowserCheck();
    // oT.input.loadPreviousFileDetails();
}

window.addEventListener('localized', onLocalized, false);

$(window).resize(function() {
    if (document.getElementById('media') ) {
        document.getElementById('media').style.width = oT.media.videoWidth();
    }
});
