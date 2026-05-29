const sanitizeHtml = require('sanitize-html');
const markedPackage = require('marked');

const marked = markedPackage.marked || markedPackage.parse || markedPackage;
const DEFAULT_MARKDOWN = '### Markdown block\n\nWrite **Markdown** here.';

function getTextbox() {
    return document.querySelector('#textbox');
}

function encodeMarkdown(markdown) {
    return encodeURIComponent(markdown || '');
}

function decodeMarkdown(encoded) {
    try {
        return decodeURIComponent(encoded || '');
    } catch (e) {
        return '';
    }
}

function isMarkdownBlock(el) {
    return el && el.classList && el.classList.contains('markdown-block');
}

function getBlockMarkdown(block) {
    const source = block.querySelector('.markdown-block-source');
    if (source) {
        return source.value;
    }
    return decodeMarkdown(block.getAttribute('data-markdown-encoded'));
}

function setBlockMarkdown(block, markdown) {
    block.setAttribute('data-markdown-encoded', encodeMarkdown(markdown));
}

function renderMarkdown(markdown) {
    const rawHTML = marked(markdown || '');
    return sanitizeHtml(rawHTML, {
        allowedTags: [
            'p', 'br', 'strong', 'em', 'b', 'i', 'a', 'ul', 'ol', 'li',
            'code', 'pre', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'
        ],
        allowedAttributes: {
            a: [ 'href', 'title', 'target', 'rel' ],
            code: [ 'class' ]
        },
        allowedSchemes: [ 'http', 'https', 'mailto' ],
        transformTags: {
            a: function(tagName, attribs) {
                return {
                    tagName,
                    attribs: Object.assign({}, attribs, {
                        target: '_blank',
                        rel: 'noopener noreferrer'
                    })
                };
            }
        }
    });
}

function setMode(block, mode, opts = {}) {
    if (mode === 'edit') {
        syncSourceHeight(block);
    }
    block.classList.toggle('editing', mode === 'edit');
    block.classList.toggle('previewing', mode === 'preview');
    if (mode === 'edit' && opts.focus) {
        const source = block.querySelector('.markdown-block-source');
        if (source) {
            source.focus();
        }
    }
}

function syncSourceHeight(block) {
    const source = block.querySelector('.markdown-block-source');
    const preview = block.querySelector('.markdown-block-preview');
    if (!source || !preview) {
        return;
    }

    const clone = preview.cloneNode(true);
    clone.style.position = 'absolute';
    clone.style.visibility = 'hidden';
    clone.style.pointerEvents = 'none';
    clone.style.display = 'block';
    clone.style.width = preview.clientWidth ? preview.clientWidth + 'px' : '100%';
    block.appendChild(clone);
    const height = Math.max(80, clone.scrollHeight);
    block.removeChild(clone);

    source.style.height = height + 'px';
}

function syncBlock(block) {
    setBlockMarkdown(block, getBlockMarkdown(block));
}

function renderBlockPreview(block) {
    const preview = block.querySelector('.markdown-block-preview');
    if (preview) {
        preview.innerHTML = renderMarkdown(getBlockMarkdown(block));
    }
}

function createRemoveButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'markdown-block-remove';
    button.setAttribute('aria-label', 'Remove Markdown block');
    button.title = 'Remove Markdown block';
    button.innerHTML = '<i class="fa fa-times"></i>';
    button.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        blockRemove(button);
    });
    return button;
}

function blockRemove(button) {
    const block = button.closest('.markdown-block');
    if (block && block.parentNode) {
        block.parentNode.removeChild(block);
    }
}

function hydrateBlock(block, opts = {}) {
    if (!isMarkdownBlock(block)) {
        return;
    }

    const markdown = getBlockMarkdown(block);
    block.innerHTML = '';
    block.contentEditable = false;
    setBlockMarkdown(block, markdown);

    const removeButton = createRemoveButton();
    const source = document.createElement('textarea');
    source.className = 'markdown-block-source';
    source.value = markdown;
    source.setAttribute('aria-label', 'Markdown source');
    source.addEventListener('input', function() {
        syncBlock(block);
        renderBlockPreview(block);
        syncSourceHeight(block);
    });

    const preview = document.createElement('div');
    preview.className = 'markdown-block-preview';

    block.appendChild(removeButton);
    block.appendChild(source);
    block.appendChild(preview);

    block.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        setMode(block, 'edit', { focus: true });
    });
    block.addEventListener('mouseleave', function() {
        syncBlock(block);
        renderBlockPreview(block);
        setMode(block, 'preview');
    });

    renderBlockPreview(block);
    setMode(block, opts.focus ? 'edit' : 'preview', { focus: opts.focus });

    if (opts.focus) {
        source.focus();
        source.select();
    }
}

function createMarkdownBlock(markdown) {
    const block = document.createElement('div');
    block.className = 'markdown-block';
    block.contentEditable = false;
    setBlockMarkdown(block, markdown);
    hydrateBlock(block);
    return block;
}

function getInsertionRange(textbox) {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) {
        return null;
    }
    const range = selection.getRangeAt(0);
    if (!textbox.contains(range.commonAncestorContainer)) {
        return null;
    }
    return range;
}

function insertAfterBlockParagraph(block) {
    const paragraph = document.createElement('p');
    paragraph.innerHTML = '<br>';
    block.parentNode.insertBefore(paragraph, block.nextSibling);
    return paragraph;
}

function insertMarkdownBlock() {
    const textbox = getTextbox();
    if (!textbox) {
        return;
    }

    const block = createMarkdownBlock(DEFAULT_MARKDOWN);
    const range = getInsertionRange(textbox);

    if (range) {
        range.deleteContents();
        range.insertNode(block);
    } else {
        textbox.appendChild(block);
    }

    insertAfterBlockParagraph(block);
    const source = block.querySelector('.markdown-block-source');
    if (source) {
        setMode(block, 'edit', { focus: true });
        source.focus();
        source.select();
    }
}

function syncMarkdownBlocks(root = document) {
    Array.from(root.querySelectorAll('.markdown-block')).forEach(syncBlock);
}

function hydrateMarkdownBlocks(root = document) {
    Array.from(root.querySelectorAll('.markdown-block')).forEach(block => hydrateBlock(block));
}

function serializeMarkdownBlocks(root) {
    if (!root) {
        return '';
    }
    syncMarkdownBlocks(root);
    const clone = root.cloneNode(true);
    Array.from(clone.querySelectorAll('.markdown-block')).forEach(block => {
        const markdown = block.getAttribute('data-markdown-encoded') || '';
        block.innerHTML = '';
        block.className = 'markdown-block';
        block.setAttribute('contenteditable', 'false');
        block.setAttribute('data-markdown-encoded', markdown);
    });
    return clone.innerHTML;
}

function getTextWithMarkdownBlocks(root) {
    if (!root) {
        return '';
    }
    syncMarkdownBlocks(root);
    const clone = root.cloneNode(true);
    Array.from(clone.querySelectorAll('.markdown-block')).forEach(block => {
        const markdown = decodeMarkdown(block.getAttribute('data-markdown-encoded'));
        block.textContent = markdown;
    });
    return clone.innerText || clone.textContent || '';
}

function setupMarkdownBlocks() {
    const textbox = getTextbox();
    if (textbox) {
        hydrateMarkdownBlocks(textbox);
    }

    const button = document.querySelector('.sbutton.markdown-block-insert');
    if (button) {
        button.addEventListener('mousedown', e => e.preventDefault());
        button.addEventListener('click', e => {
            e.preventDefault();
            insertMarkdownBlock();
        });
    }
}

export {
    hydrateMarkdownBlocks,
    getTextWithMarkdownBlocks,
    insertMarkdownBlock,
    serializeMarkdownBlocks,
    setupMarkdownBlocks,
    syncMarkdownBlocks
};
