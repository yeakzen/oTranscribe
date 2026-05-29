const sanitizeHtml = require('sanitize-html');

export function cleanHTML(dirty) {
    return sanitizeHtml(dirty, {
        allowedTags: [ 'b', 'i', 'em', 'strong', 'a', 'p', 'span', 'br', 'div' ],
        transformTags: {
            'div': function(tagName, attribs) {
                const classes = (attribs.class || '').split(/\s+/);
                if (classes.indexOf('markdown-block') > -1) {
                    return {
                        tagName: 'div',
                        attribs: {
                            class: 'markdown-block',
                            contenteditable: 'false',
                            'data-markdown-encoded': attribs['data-markdown-encoded'] || ''
                        }
                    };
                }
                return {
                    tagName: 'p',
                    attribs: {}
                };
            },
        },
        allowedAttributes: {
            'span': [ 'class', 'data-timestamp', 'contentEditable', 'contenteditable' ],
            'div': [ 'class', 'contentEditable', 'contenteditable', 'data-markdown-encoded' ]
        }
    });
};
