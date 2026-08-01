import { cleanHTML } from './clean-html';
import { activateTimestamps } from './timestamps';
import { getTextWithMarkdownBlocks, hydrateMarkdownBlocks } from './markdown-blocks';
const $ = require('jquery');

const DOCUMENT_HIDDEN_CLASS = 'document-hidden';

function countWords(str){
    var trimmedStr = $.trim(str);
    if (trimmedStr){
        return trimmedStr.match(/\S+/gi).length;
    }
    return 0;
}

function countTextbox(){
    var textboxElement = document.getElementById('textbox');
    var textboxText = getTextWithMarkdownBlocks(textboxElement);
    var count = countWords(textboxText);
      
    var wordcountText = document.webL10n.get('wordcount', {n: count});
    wordcountText = wordcountText.replace(/(\d+)/, (n) => {
        return `<span class="word-count-number">${n}</span>`;
    });
    document.querySelector('.wc-text').innerHTML = wordcountText;
}

function initWordCount(){
    countTextbox();
    setInterval(function(){
        countTextbox();
    }, 1000);
    
}


function watchFormatting(){
    var b = document.queryCommandState("Bold");
    var bi = document.getElementById("icon-b");
    var i = document.queryCommandState("italic");
    var ii = document.getElementById("icon-i");
    
    if (!bi || !ii) return;
    
    if (b === true){
        bi.className = "fa fa-bold active"
    } else {
        bi.className = "fa fa-bold"
    }
    if (i === true){
        ii.className = "fa fa-italic active"
    } else {
        ii.className = "fa fa-italic"
    }
}

function initWatchFormatting(){
    setInterval(function(){
        watchFormatting();
    }, 100);
}

function setEditorContents( dirtyText, opts = {} ) {
    
    const newText = cleanHTML(dirtyText);

    var $textbox = $("#textbox");
    
    function replaceText() {
        if (typeof newText === 'string') {
            $textbox[0].innerHTML = newText;
        } else {
            textbox[0].innerHTML = '';
            $textbox[0].appendChild(newText);    
        }
        activateTimestamps();
        hydrateMarkdownBlocks($textbox[0]);
        $('.textbox-container').scrollTop(0);
    }
    
    if (opts.transition) {
        $textbox.fadeOut(300,function(){
            replaceText();
            $(this).fadeIn(300);
        });        
    } else {
        replaceText();
    }

}

function initAutoscroll() {
  var isScrolledToBottom = false;

  var container = document.querySelector('.textbox-container');
  var textbox = document.querySelector('#textbox');

  // update isScrolledToBottom on scroll event (true within 50px of the bottom of container)
  container.addEventListener('scroll', function() {
    isScrolledToBottom = container.scrollHeight - container.clientHeight - container.scrollTop <= 50;
  });

  // scroll to bottom on the input event, if isScrolledToBottom is true
  textbox.addEventListener('input', function() {
    if(isScrolledToBottom) {
      container.scrollTop = container.scrollHeight;
    }
  });
}

function syncDocumentVisibilityButton(isHidden) {
    const button = document.querySelector('.sbutton.document-visibility');
    if (!button) {
        return;
    }

    const icon = button.querySelector('i');
    const label = button.querySelector('.label');
    const actionLabel = isHidden ? 'Show document' : 'Hide document';

    button.setAttribute('aria-pressed', isHidden ? 'true' : 'false');
    button.setAttribute('aria-label', actionLabel);
    button.setAttribute('title', actionLabel);

    if (icon) {
        icon.className = isHidden ? 'fa fa-eye-slash active' : 'fa fa-eye';
    }
    if (label) {
        label.textContent = isHidden ? 'show doc' : 'hide doc';
    }
}

function setDocumentVisible(isVisible) {
    const container = document.querySelector('.textbox-container');
    if (!container) {
        return;
    }

    container.classList.toggle(DOCUMENT_HIDDEN_CLASS, !isVisible);
    syncDocumentVisibilityButton(!isVisible);
}

function toggleDocumentVisibility() {
    const container = document.querySelector('.textbox-container');
    if (!container) {
        return;
    }

    setDocumentVisible(container.classList.contains(DOCUMENT_HIDDEN_CLASS));
}

function initDocumentVisibilityToggle() {
    const button = document.querySelector('.sbutton.document-visibility');
    setDocumentVisible(true);

    if (!button) {
        return;
    }

    button.addEventListener('click', function(e) {
        e.preventDefault();
        toggleDocumentVisibility();
    });
}

export {
    initWatchFormatting as watchFormatting,
    initWordCount as watchWordCount,
    setEditorContents as setEditorContents,
    initAutoscroll as initAutoscroll,
    initDocumentVisibilityToggle as initDocumentVisibilityToggle
};
